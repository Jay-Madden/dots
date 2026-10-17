# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:/usr/local/bin:$PATH

# Path to your oh-my-zsh installation.
export ZSH="$HOME/.oh-my-zsh"
source "$HOME/.config/zsh/common.zsh"

# Add nvm to path
export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" # This loads nvm

# Jump with zoxide and run onefetch when we navigate to a new repo
LAST_REPO=""
cd() {
    __zoxide_z "$@";
    git rev-parse 2>/dev/null;

    if [ $? -eq 0 ]; then
        if [ "$LAST_REPO" != $(basename $(git rev-parse --show-toplevel)) ]; then
        gtimeout 1 onefetch --disabled-fields authors contributors commits churn
        LAST_REPO=$(basename $(git rev-parse --show-toplevel))
        fi
    fi
}

# Setup PATH
export PATH="/opt/homebrew/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"
export PATH="$HOME/.yarn/bin:$HOME/.config/yarn/global/node_modules/.bin:$PATH"

# Add dotnet to $PATH
export PATH="/usr/local/share/dotnet:$PATH"

# Add dotnet tools to path
export PATH="$PATH:$HOME/.dotnet/tools"

#Add GO to $PATH
export PATH="$PATH:$HOME/go/bin"

# Add krew to path
export PATH="${KREW_ROOT:-$HOME/.krew}/bin:$PATH"

# Add vscode to PATH
export PATH="$PATH:/Applications/Visual Studio Code.app/Contents/Resources/app/bin"
alias code="/Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code"

# Set pi config dir
export PI_CONFIG_DIR="$HOME/.config/pi"
export PI_CODING_AGENT_DIR="$HOME/.config/pi/agent"

# Set name of the theme to load --- if set to "random", it will
# load a random theme each time oh-my-zsh is loaded, in which case,
# to know which specific one was loaded, run: echo $RANDOM_THEME
# See https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
# ZSH_THEME="spaceship"

# Enable kubernetes support in prompt
# SPACESHIP_KUBECTL_SHOW=true
# SPACESHIP_KUBECTL_CONTEXT_SHOW=true
# SPACESHIP_KUBECTL_VERSION_SHOW=false


# Set list of themes to pick from when loading at random
# Setting this variable when ZSH_THEME=random will cause zsh to load
# a theme from this variable instead of looking in $ZSH/themes/
# If set to an empty array, this variable will have no effect.
# ZSH_THEME_RANDOM_CANDIDATES=( "robbyrussell" "agnoster" )

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# Uncomment the following line to use hyphen-insensitive completion.
# Case-sensitive completion must be off. _ and - will be interchangeable.
# HYPHEN_INSENSITIVE="true"

# Uncomment one of the following lines to change the auto-update behavior
# zstyle ':omz:update' mode disabled  # disable automatic updates
# zstyle ':omz:update' mode auto      # update automatically without asking
# zstyle ':omz:update' mode reminder  # just remind me to update when it's time

# Uncomment the following line to change how often to auto-update (in days).
# zstyle ':omz:update' frequency 13

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS="true"

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# You can also set it to another string to have that shown instead of the default red dots.
# e.g. COMPLETION_WAITING_DOTS="%F{yellow}waiting...%f"
# Caution: this setting can cause issues with multiline prompts in zsh < 5.7.1 (see #5765)
COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# You can set one of the optional three formats:
# "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# or set a custom format using the strftime function format specifications,
# see 'man strftime' for details.
# HIST_STAMPS="mm/dd/yyyy"

# Would you like to use another custom folder than $ZSH/custom?
# ZSH_CUSTOM=/path/to/new-custom-folder

# Which plugins would you like to load?
# Standard plugins can be found in $ZSH/plugins/
# Custom plugins may be added to $ZSH_CUSTOM/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
setup_omz
setup_starship

# Setup completions

# User configuration



# export MANPATH="/usr/local/man:$MANPATH"

# You may need to manually set your language environment
# export LANG=en_US.UTF-8

# Preferred editor for local and remote sessions
# if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='mvim'
# fi

#Compilation flags
# export ARCHFLAGS="-arch x86_64"

# Export config repo to '.config'
export XDG_CONFIG_HOME="$HOME/.config"

# Set zsh-autosuggestions color style

# Set personal aliases, overriding those provided by oh-my-zsh libs,
# plugins, and themes. Aliases can be placed here, though oh-my-zsh
# users are encouraged to define aliases within the ZSH_CUSTOM folder.
# For a full list of active aliases, run `alias`.
#
# Example aliases
# alias zshconfig="mate ~/.zshrc"
# alias ohmyzsh="mate ~/.oh-my-zsh"

# Command Aliases
setup_aliases

if [[ "$OSTYPE" == darwin* ]]; then
    alias pwdc='pwd | pbcopy'
fi

# neovim aliases
vim() {
    local current_dir=$(pwd -P)
    local resumed=0

    local job_lines=("${(@f)$(jobs -l)}")
    for job_line in "${job_lines[@]}"; do
        if ! [[ "$job_line" =~ "([Ss]uspended|[Ii]nterrupted|[Rr]unning)" ]]; then
            continue
        fi

        # Extract PID from job_line using zsh match[]
        if [[ "$job_line" =~ '\[[0-9]+\][[:space:]]+.[[:space:]]+([0-9]+)' ]]; then
            local job_pid="${match[1]}"
            echo "Found job_pid: $job_pid"
        else
            continue
        fi

        if [ -z "$job_pid" ] || ! kill -0 "$job_pid" 2>/dev/null; then
            continue
        fi

        local job_cwd=$(lsof -a -p $job_pid -d cwd | awk 'NR==2 {print $9}')

        if [ -z "$job_cwd" ]; then
            continue
        fi

        # Extract job number from the line
        if [[ "$job_line" =~ "^\[([-1-9]+)\]" ]]; then
            local job_num="${match[1]}"
        else
            continue
        fi

        echo "job_cwd: $job_cwd, current_dir: $current_dir, job_num: $job_num"
        if [ "$job_cwd" = "$current_dir" ]; then
            fg %"$job_num" 2>/dev/null
            resumed=1
            break
        fi
    done

    # If no matching suspended job was found, start a new nvim
    if [ $resumed -eq 0 ]; then
        echo "All variables: resumed=$resumed, current_dir=$current_dir"
        nvim "$@"
    fi
}

# Custom watch function using raw ANSI termcodes
# Usage: watch <command> [args...]
watch() {
  local interval=2 # Default to 2 seconds
  local output=""

  if [[ $# -eq 0 ]]; then
    echo "Usage: watch <command> [args...]"
    return 1
  fi

  echo "watch: Press Ctrl+C to exit"

  while :; do
    # Run the command and capture its output (stderr is redirected to stdout for visibility)
    output=$("$@" 2>&1)

    # Check if there is output
    if [[ -n "$output" ]]; then
      # Use printf with ANSI escape codes to clear screen and move cursor home
      # \033[2J clears screen, \033[H moves cursor to top-left
      printf "\033[2J\033[H"

      # Print the command being run and the current time as a header
      echo "Every $interval.0s: $*"
      echo "$(date)"
      echo "--------------------------------------------------------"

      # Print the captured command output
      echo "$output"
    fi

    sleep $interval
  done
}

killrabbit() {
    emulate -L zsh
    local pr_id thread_ids thread_id
    local resolved=0

    pr_id=$(gh pr view --json id,state --jq 'select(.state == "OPEN") | .id') || return 1
    if [[ -z "$pr_id" ]]; then
        print -u2 -- "killrabbit: no open PR for the current branch"
        return 1
    fi

    thread_ids=$(gh api graphql --paginate -f pr="$pr_id" -f query='
        query($pr: ID!, $endCursor: String) {
            node(id: $pr) {
                ... on PullRequest {
                    reviewThreads(first: 100, after: $endCursor) {
                        nodes {
                            id
                            isResolved
                            comments(first: 1) { nodes { author { login } } }
                        }
                        pageInfo { hasNextPage endCursor }
                    }
                }
            }
        }
    ' --jq '
        .data.node.reviewThreads.nodes[]
        | select(.isResolved == false)
        | select(.comments.nodes[0].author.login == "coderabbitai"
            or .comments.nodes[0].author.login == "coderabbitai[bot]")
        | .id
    ') || return 1

    if [[ -z "$thread_ids" ]]; then
        print -- "killrabbit: no unresolved CodeRabbit review threads"
        return 0
    fi

    for thread_id in "${(@f)thread_ids}"; do
        gh api graphql -f thread="$thread_id" -f query='
            mutation($thread: ID!) {
                resolveReviewThread(input: {threadId: $thread}) {
                    thread { isResolved }
                }
            }
        ' --silent || {
            print -u2 -- "killrabbit: failed on thread $thread_id after resolving $resolved thread(s)"
            return 1
        }
        resolved=$((resolved + 1))
    done

    print -- "killrabbit: resolved $resolved CodeRabbit review thread(s)"
}

# Kubernetes aliases
source /opt/homebrew/share/zsh/site-functions/_kubectl

# Simple cluster selector
alias cs="export KUBECONFIG=\$(fd '.*' $HOME/.kube/configs/* | tv --ui-scale 40)"

alias zt="$HOME/.config/zellij/zt"

TARGET="wasm32-wasip1"
if [[ "$PWD" == "$HOME" ]] && ! rustup target list --installed | grep -q "^$TARGET$"; then
    rustup target add "$TARGET"
fi

DYN_TAB_WASM="$HOME/.config/zellij/plugins/dyn-tab/target/wasm32-wasip1/release/dyn-tab.wasm"
if [[ ! -f "$DYN_TAB_WASM" ]]; then
    cargo build --release --target wasm32-wasip1 --manifest-path "$HOME/.config/zellij/plugins/dyn-tab/Cargo.toml"
fi
unset DYN_TAB_WASM

if [[ -n "$ZELLIJ" ]]; then
    zellij action start-or-reload-plugin "dyn-tab"
fi

export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"

# Load zoxide
setup_zoxide

setup_completion

export EDITOR="nvim"

# Setup wezterm config file
export WEZTERM_CONFIG_DIR="$HOME/.config/wezterm"
export WEZTERM_CONFIG_FILE="$HOME/.config/wezterm/wezterm.lua"

export GPG_TTY=$(tty)

source $HOME/.zshrc
