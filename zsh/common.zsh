setup_omz() {
    export ZSH="$HOME/.oh-my-zsh"
    ZSH_THEME=""
    ZVM_VI_INSERT_ESCAPE_BINDKEY=jj
    ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=23'
    zvm_after_init_commands+=(setup_keybindings setup_atuin)

    plugins=(
        git
        fzf-tab
        zsh-autosuggestions
        zsh-vi-mode
        zsh-syntax-highlighting
    )

    fpath+=("${ZSH_CUSTOM:-$ZSH/custom}/plugins/zsh-completions/src")
    source "$ZSH/oh-my-zsh.sh"
}

setup_keybindings() {
    # zsh-vim configs
    autoload -Uz edit-command-line
    zle -N edit-command-line
    bindkey -M vicmd '^V' edit-command-line

    # Unbind execute mode
    bindkey -a -r ':'
    # Immediately show completions
    bindkey -M viins '\t' fzf-tab-complete

    # Remove the annoying common prefix tabbing
    setopt menucomplete
}

setup_completion() {
    # Configure default completion styles for fzf-tab
    # # disable sort when completing `git checkout`
    zstyle ':completion:*:git-checkout:*' sort false
    # NOTE: don't use escape sequences (like '%F{red}%d%f') here, fzf-tab will ignore them
    zstyle ':completion:*:descriptions' format '[%d]'
    # force zsh not to show completion menu, which allows fzf-tab to capture the unambiguous prefix
    zstyle ':completion:*' menu no
    # preview directory's content with eza when completing cd
    zstyle ':fzf-tab:complete:cd:*' fzf-preview 'eza --oneline --color=always $realpath'
    # set list-colors to enable filename colorizing
    zstyle ':completion:*' list-colors ${(s.:.)LS_COLORS}
    # custom fzf flags
    # NOTE: fzf-tab does not follow FZF_DEFAULT_OPTS by default
    zstyle ':fzf-tab:*' fzf-flags --bind=tab:accept --style minimal --bind 'focus:transform-header:file --brief {}'
}

setup_atuin() {
    # Setup atuin
    eval "$(atuin init zsh)"
}

setup_zoxide() {
    eval "$(zoxide init zsh)"
}

setup_starship() {
    # Initialize starship prompt
    export STARSHIP_CONFIG="$HOME/.config/zsh/starship.toml"
    eval "$(starship init zsh)"
}

setup_aliases() {
    export BAT_THEME="1337"
    alias cat='bat --paging=never'

    alias c='clear'
    alias python='python3'
    alias h='atuin history list'
    alias cdi='zi'
    alias lg='lazygit'
    alias ovim='/usr/bin/vim'
    alias k='kubectl'

    if command -v eza >/dev/null 2>&1; then
        alias ls='eza --all --long --group --icons --color=always --group-directories-first'
        alias ll='eza --all --long --inode --sort=size --group --header --icons --color=always --group-directories-first'
        alias lt='eza --extended --all --long --tree --icons --color=always'
        alias lr='eza --all --long --group --icons --sort=modified --color=always --group-directories-first'
    else
        alias l='ls --all --format=long --human-readable --group-directories-first'
        alias ll='ls --all --format=long --group-directories-first'
        alias lr='ls --all --format=long --sort=time --reverse --human-readable --group-directories-first'
    fi
}
