const dotenv = require('dotenv');
dotenv.config();

const pty = require('node-pty');
const readline = require('readline');
const chalk = require('chalk');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

fs.mkdirSync("completions", { recursive: true });

let currentLine = '';
let ghostText = '';
let debounceTimer;
let ghostVisible = false;
let shellContent = '';
let ghostPromptId = 0;
const debounceDelay = 500; // 500 milliseconds debounce delay
const DEL = '\u007F'; // ASCII code for backspace

const openaiApi = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

function processShellBuffer(inputString) {
    // Removing specific escape code `\u001b[?2004h`
    const specificEscapeCodeRegex = /\x1b\[\?[0-9]+h/g;

    // Remove ANSI escape codes
    const ansiEscapeRegex = /\x1b\[[0-9;]*[a-zA-Z]/g;

    // Remove OSC (Operating System Command) sequences
    const oscRegex = /\x1b\][^\x07]*\x07/g;

    // Remove non-printable characters except newline
    const nonPrintableRegex = /[\x00-\x09\x0B-\x1F\x7F]/g;

    // Process the string
    let processedString = inputString.replace(specificEscapeCodeRegex, '')
        .replace(ansiEscapeRegex, '')
        .replace(oscRegex, '')
        .replace(nonPrintableRegex, '');

    return processedString;
}

async function createChatCompletion(messages) {
    const completionId = `${new Date().getTime()}-${Math.random().toString(36).substring(7)}`;
    const chatCompletion = await openaiApi.chat.completions.create({
        messages,
        model: "gpt-4",
        stop: "\n"
    });
    const chatCompletionResult = chatCompletion.choices[0].message.content;
    fs.writeFileSync(
        path.join("completions", `${completionId}.json`),
        JSON.stringify([
            ...messages,
            { role: "assistant", content: chatCompletionResult }
        ], null, 4),
        "utf-8"
    );
    return chatCompletionResult;
}

// Function that returns the length of the current line
async function promptGhost(currentLine) {
    const messages = [
        { role: "system", content: "Your task is to generate a COMPLETION for the user's terminal session. Your answer MUST ONLY contain the completion, that we should input at the cursor's current position, indicated by <|CURSOR|>. Do not respond with anything else, only the remaining characters in the current command line!" },
        { role: "user", content: processShellBuffer(shellContent) + "<|CURSOR|>" }
    ];

    const chatCompletionResult = await createChatCompletion(messages);

    // Shows (length, last char ASCII)
    return `${chatCompletionResult}`;
}

// Function to format ghost text
function formatGhost(ghostText) {
    return `${chalk.dim(ghostText)}`;
}

// Function to simulate deletes in a string
function interpolateLine(currentLine) {
    let buf = '';
    let cursor = 0;
    for (let i = 0; i < currentLine.length; i++) {
        let ch = currentLine[i];
        if (ch === '\n') {
            break;
        } else if (ch === '\b') {
            cursor--;
        } else if (ch === DEL) {
            buf = buf.substring(0, cursor - 1) + buf.substring(cursor);
            cursor--;
        } else if (ch === '\r') {
            cursor = 0;
        } else {
            if (cursor !== buf.length) {
                buf = buf.substring(0, cursor) + ch + buf.substring(cursor);
            } else {
                buf += ch;
            }
            cursor++;
        }
    }

    return buf;
}

// Initialize the pseudo-terminal with a shell
const shell = pty.spawn('bash', ["--login"], {
    name: 'xterm-color',
    cols: process.stdout.columns,
    rows: process.stdout.rows,
    cwd: process.env.HOME,
    env: process.env
});

// Setup for handling keypress events
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
}

function clearGhost() {
    if (ghostVisible) {
        process.stdout.write('\b \b'.repeat(ghostText.length));
        ghostText = '';
        ghostVisible = false;
    }
}

function showGhost() {
    if (!ghostVisible) {
        process.stdout.write(
            formatGhost(ghostText)
        );
        ghostVisible = true;
    }
}

function fileLog(...args) {
    fs.appendFileSync('log.txt', args.map(arg => JSON.stringify(arg)).join(' ') + '\n');
}

const promptAi = () => {
    // Clear any existing debounce timer
    clearTimeout(debounceTimer);

    debounceTimer = setTimeout(async () => {
        const promptedAt = ghostPromptId++;
        ghostText = '...';
        showGhost();
        const newGhostText = await promptGhost(currentLine);
        if (promptedAt === ghostPromptId - 1) {
            clearGhost();
            ghostText = newGhostText;
            showGhost();
        }
    }, debounceDelay);
}

// Handling each keypress
process.stdin.on('keypress', (chunk, key) => {
    fileLog('keypress', chunk, key, currentLine, ghostText, ghostVisible, shellContent);

    // Erase the previous ghost text
    const gt = `${ghostText}`;
    clearGhost();

    if (key && key.ctrl && key.name === 'c') {
        clearGhost();
        shell.write(chunk);
    } else if (key && key.name === 'tab') {
        clearGhost();
        shell.write(gt);
        currentLine += gt;
        currentLine = interpolateLine(currentLine);
        fileLog('appendghost', currentLine, gt);
    } else if (key && key.name === 'return') {
        clearGhost();
        shell.write(chunk);
        fileLog('return', currentLine);
        currentLine = '';
        promptAi();
    } else {
        shell.write(chunk);
        currentLine += chunk; // Append the new character to currentLine
        currentLine = interpolateLine(currentLine); // Simulate deletes in the string

        // Debounce setup
        promptAi();
    }
});

// Print shell output to the console
shell.on('data', function (data) {
    process.stdout.write(data);
    shellContent += data;
    shellContent = shellContent.slice(-8000); // Keep only the last 8000 characters
});

// Handle shell exit
shell.on('exit', function (code) {
    console.log(`Shell process exited with code ${code}`);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.exit(code);
});
