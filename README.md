# Bash Copilot

![](demo.gif)

This is just a very small Node.JS program, that starts `/bin/bash` through `node-pty`. When the user presses keys, after a little bit of _debouncing_ the _ChatGPT API_ is called to get a completion for the current command line. Pressing `TAB` will insert the completion into the command line.

## Running

You need _Node.JS_ to run this app.

_First, install the dependencies using `npm`._

```bash
npm install
```

_Now, you must create a `.env` file, and place the `OPENAI_API_KEY` variable in it._

```bash
echo "OPENAI_API_KEY=your-api-key" > .env
```

_Now, you can run the app._

```bash
npm run start
```
