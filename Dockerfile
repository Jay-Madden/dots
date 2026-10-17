FROM debian:trixie-slim

ARG USERNAME=jay
ARG NVIM_VERSION=stable
ARG ZELLIJ_VERSION=v0.45.1
ARG YQ_VERSION=v4.54.1

ENV DOTFILES_CONTAINER=1

RUN apt-get update \
    && apt-get install --assume-yes --no-install-recommends \
        # Shell, history, and navigation
        atuin \
        fzf \
        starship \
        zoxide \
        zsh \
        # Files, search, and Git
        bat \
        eza \
        fd-find \
        file \
        git \
        jq \
        less \
        ripgrep \
        # Networking and TLS
        ca-certificates \
        curl \
        dnsutils \
        iproute2 \
        iputils-ping \
        netcat-openbsd \
        openssl \
        tcpdump \
        # Process and filesystem debugging
        lsof \
        procps \
        psmisc \
        strace \
    # Remove apt indexes in this layer so they do not increase image size.
    && rm --recursive --force /var/lib/apt/lists/*

RUN case "$(dpkg --print-architecture)" in \
        amd64) arch=x86_64 ;; \
        arm64) arch=arm64 ;; \
        *) echo "Unsupported Neovim architecture" >&2; exit 1 ;; \
    esac \
    && curl --fail --silent --show-error --location \
        "https://github.com/neovim/neovim/releases/download/${NVIM_VERSION}/nvim-linux-${arch}.tar.gz" \
        | tar --extract --gzip --directory=/usr/local --strip-components=1

RUN case "$(dpkg --print-architecture)" in \
        amd64) arch=x86_64 ;; \
        arm64) arch=aarch64 ;; \
        *) echo "Unsupported Zellij architecture" >&2; exit 1 ;; \
    esac \
    && curl --fail --silent --show-error --location \
        "https://github.com/zellij-org/zellij/releases/download/${ZELLIJ_VERSION}/zellij-${arch}-unknown-linux-musl.tar.gz" \
        | tar --extract --gzip --directory=/usr/local/bin zellij

RUN arch="$(dpkg --print-architecture)" \
    && curl --fail --silent --show-error --location \
        "https://dl.k8s.io/release/v1.36.0/bin/linux/${arch}/kubectl" \
        --output /usr/local/bin/kubectl \
    && curl --fail --silent --show-error --location \
        "https://dl.k8s.io/release/v1.36.0/bin/linux/${arch}/kubectl.sha256" \
        --output /tmp/kubectl.sha256 \
    && printf '%s  /usr/local/bin/kubectl\n' "$(cat /tmp/kubectl.sha256)" | sha256sum --check \
    && chmod --changes 0755 /usr/local/bin/kubectl

RUN arch="$(dpkg --print-architecture)" \
    && curl --fail --silent --show-error --location \
        "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_${arch}" \
        --output /usr/local/bin/yq \
    && chmod 0755 /usr/local/bin/yq

RUN ln --symbolic /usr/bin/batcat /usr/local/bin/bat \
    && ln --symbolic /usr/bin/fdfind /usr/local/bin/fd

RUN useradd --uid 1000 --create-home --user-group --shell /bin/zsh "${USERNAME}"

USER ${USERNAME}
WORKDIR /home/${USERNAME}
ENV HOME=/home/${USERNAME}
ENV EDITOR=nvim

RUN git clone --depth=1 https://github.com/ohmyzsh/ohmyzsh.git "${HOME}/.oh-my-zsh" \
    && git clone --depth=1 https://github.com/Aloxaf/fzf-tab.git "${HOME}/.oh-my-zsh/custom/plugins/fzf-tab" \
    && git clone --depth=1 https://github.com/zsh-users/zsh-autosuggestions.git "${HOME}/.oh-my-zsh/custom/plugins/zsh-autosuggestions" \
    && git clone --depth=1 https://github.com/jeffreytse/zsh-vi-mode.git "${HOME}/.oh-my-zsh/custom/plugins/zsh-vi-mode" \
    && git clone --depth=1 https://github.com/zsh-users/zsh-syntax-highlighting.git "${HOME}/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting" \
    && git clone --depth=1 https://github.com/zsh-users/zsh-completions.git "${HOME}/.oh-my-zsh/custom/plugins/zsh-completions"

COPY --chown=${USERNAME}:${USERNAME} nvim/ /home/${USERNAME}/.config/nvim/

RUN nvim --headless "+Lazy! install" +qa \
    # Remove plugin Git metadata and tests in this layer to reduce image size.
    && find "${HOME}/.local/share/nvim/lazy" \
        -type d \( -name .git -o -name tests \) \
        -prune -exec rm --recursive --force {} +

COPY --chown=${USERNAME}:${USERNAME} atuin/config.toml /home/${USERNAME}/.config/atuin/config.toml
COPY --chown=${USERNAME}:${USERNAME} zsh/.zshrc.container /home/${USERNAME}/.zshrc
COPY --chown=${USERNAME}:${USERNAME} zsh/common.zsh /home/${USERNAME}/.config/zsh/common.zsh
COPY --chown=${USERNAME}:${USERNAME} zsh/starship.toml /home/${USERNAME}/.config/zsh/starship.toml

COPY --chown=${USERNAME}:${USERNAME} zellij/config.kdl /home/${USERNAME}/.config/zellij/config.kdl
COPY --chown=${USERNAME}:${USERNAME} zellij/layouts/container.kdl /home/${USERNAME}/.config/zellij/layouts/container.kdl

COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/container-entrypoint

ENTRYPOINT ["/usr/local/bin/container-entrypoint"]
CMD ["zellij", "--layout", "container"]
