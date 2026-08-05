# dyn-tab

A small WASM tab bar plugin and development layout for Zellij

## Start the development workspace

Install the Rust WASI target once:

```bash
rustup target add wasm32-wasip1
```

Start Zellij from this directory so the relative paths in the layout resolve correctly:

```bash
cd ~/.config/zellij/plugins/dyn-tab
zellij --layout plugin-development-workspace.kdl
```
