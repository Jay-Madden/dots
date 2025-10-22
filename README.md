# My dotfiles 

and other misc configurations

## Setup

* Clone the repo into a temp dir and then move into the top level folder so as to not conflict with exsting config. 
    ```bash
    git clone --recursive https://github.com/Jay-Madden/dots temp
    mv temp/.git code/.git
    rm -rf temp
    ```

In order to bootstrap the zsh configuration we have to redirect to the XDG config paths

* Set `ZDOTDIR` in the root `.zshenv`
    ```bash
    cat >> $HOME/.zshenv << EOF
    export XDG_CONFIG_HOME=${XDG_CONFIG_HOME:=${HOME}/.config}
    export ZDOTDIR=${ZDOTDIR:=${XDG_CONFIG_HOME}/zsh}
    source $ZDOTDIR/.zshenv
    EOF
    ```
2. Reload the shell
    ```
    exec zsh
    ```
