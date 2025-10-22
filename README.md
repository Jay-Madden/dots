# My dotfiles 

and other misc configurations

## Setup

In order to bootstrap the zsh configuration we have to redirect to the XDG config paths

1. ```bash
    cat << EOF
    export XDG_CONFIG_HOME=${XDG_CONFIG_HOME:=${HOME}/.config}
    export ZDOTDIR=${ZDOTDIR:=${XDG_CONFIG_HOME}/zsh}
    source $ZDOTDIR/.zshenv
    EOF
    ```
2. ```
    exec zsh
    ```
