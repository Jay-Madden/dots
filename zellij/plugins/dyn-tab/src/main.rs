use std::collections::HashMap;
use std::path::Path;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};
use zellij_tile::prelude::*;

#[derive(Default)]
struct TabBar {
    mode_info: Option<ModeInfo>,
    tabs: Vec<TabInfo>,
    hitboxes: Vec<(usize, usize, usize)>,
    tab_processes: HashMap<usize, String>,
    tab_cwds: HashMap<usize, String>,
}

register_plugin!(TabBar);

impl ZellijPlugin for TabBar {
    fn load(&mut self, _configuration: std::collections::BTreeMap<String, String>) {
        set_selectable(true);
        subscribe(&[
            EventType::ModeUpdate,
            EventType::TabUpdate,
            EventType::PaneUpdate,
            EventType::CommandChanged,
            EventType::CwdChanged,
            EventType::Mouse,
            EventType::PermissionRequestResult,
        ]);
        request_permission(&[
            PermissionType::ReadApplicationState,
            PermissionType::ChangeApplicationState,
        ]);
    }

    fn update(&mut self, event: Event) -> bool {
        match event {
            Event::ModeUpdate(mode_info) => {
                let should_render = self.mode_info.as_ref() != Some(&mode_info);
                self.mode_info = Some(mode_info);
                should_render
            }
            Event::TabUpdate(tabs) => {
                self.set_tabs(tabs);
                true
            }
            Event::PaneUpdate(manifest) => self.load_pane_contexts(&manifest),
            Event::CommandChanged(pane_id, command, is_foreground, focused_clients) => {
                if focused_clients.is_empty() {
                    return false;
                }
                let Ok((tab_idx, focused_pane_id)) = get_focused_pane_info() else {
                    return false;
                };
                if pane_id != focused_pane_id {
                    return false;
                }
                self.set_running_process(tab_idx, &command, is_foreground)
            }
            Event::CwdChanged(pane_id, cwd, focused_clients) => {
                if focused_clients.is_empty() {
                    return false;
                }
                let Ok((tab_idx, focused_pane_id)) = get_focused_pane_info() else {
                    return false;
                };
                if pane_id != focused_pane_id {
                    return false;
                }
                self.set_cwd(tab_idx, &cwd)
            }
            Event::PermissionRequestResult(PermissionStatus::Granted) => {
                set_selectable(false);
                self.load_existing_tabs();
                true
            }
            Event::Mouse(Mouse::LeftClick(_, column)) => {
                if let Some(tab_position) = self.tab_at(column) {
                    go_to_tab((tab_position + 1) as u32);
                }
                false
            }
            _ => false,
        }
    }

    fn render(&mut self, rows: usize, cols: usize) {
        if rows == 0 || cols == 0 {
            return;
        }

        self.hitboxes.clear();
        let mut output = String::new();
        let mut used = 0;

        if let Some(mode_info) = &self.mode_info {
            let label = truncate_to_width(
                &format!(" {:?} ", mode_info.mode).to_uppercase(),
                cols,
            );
            let width = UnicodeWidthStr::width(label.as_str());
            output.push_str(&serialize_text(&mode_text(mode_info, label)));
            used += width;
        }

        for tab in &self.tabs {
            if used >= cols {
                break;
            }

            // 4 padding for the arrows in the font
            const ARROW_PADDING: usize = 4;

            let available_width = cols.saturating_sub(used + ARROW_PADDING);
            let label = truncate_to_width(&self.tab_label(tab), available_width);
            let label_width = UnicodeWidthStr::width(label.as_str());
            if label_width == 0 {
                break;
            }
            let width = label_width + ARROW_PADDING;

            output.push_str(&serialize_ribbon(&tab_text(tab, label)));
            self.hitboxes.push((used, used + width, tab.position));
            used += width;
        }

        if used < cols {
            output.push_str(&serialize_text(&Text::new(" ".repeat(cols - used)).opaque()));
        }

        print!("{output}");
    }
}

impl TabBar {
    fn load_existing_tabs(&mut self) {
        let Ok(snapshot) = get_session_list() else { return };

        if let Some(session) = snapshot
            .live_sessions
            .into_iter()
            .find(|session| session.is_current_session)
        {
            self.set_tabs(session.tabs);
        }
    }

    fn set_tabs(&mut self, mut tabs: Vec<TabInfo>) {
        tabs.sort_by_key(|tab| tab.position);
        self.tabs = tabs;
    }

    fn load_pane_contexts(&mut self, manifest: &PaneManifest) -> bool {
        let mut changed = false;

        for (tab_position, panes) in &manifest.panes {
            for pane in panes {
                if !pane.is_focused || pane.is_plugin {
                    continue;
                }

                let pane_id = PaneId::Terminal(pane.id);
                if let Ok(cwd) = get_pane_cwd(pane_id) {
                    changed = self.set_cwd(*tab_position, &cwd) || changed;
                }
                if let Ok(command) = get_pane_running_command(pane_id) {
                    let is_foreground = !self.is_shell_command(&command);
                    changed = self.set_running_process(
                        *tab_position,
                        &command,
                        is_foreground,
                    ) || changed;
                }
                break;
            }
        }

        changed
    }

    fn is_shell_command(&self, command: &[String]) -> bool {
        let Some(process) = process_name(command) else {
            return false;
        };

        // Compare filenames so "/bin/zsh" matches "zsh".
        self.mode_info
            .as_ref()
            .and_then(|mode_info| mode_info.shell.as_ref())
            .and_then(|shell| shell.file_name())
            .and_then(|shell| shell.to_str())
            .map(|shell| shell == process)
            .unwrap_or(false)
    }

    fn set_running_process(
        &mut self,
        tab_position: usize,
        command: &[String],
        is_foreground: bool,
    ) -> bool {
        if !is_foreground {
            return self.tab_processes.remove(&tab_position).is_some();
        }

        match process_name(command) {
            Some(process) => {
                let changed = self.tab_processes.get(&tab_position) != Some(&process);
                self.tab_processes.insert(tab_position, process);
                changed
            }
            None => false,
        }
    }

    fn set_cwd(&mut self, tab_position: usize, cwd: &Path) -> bool {
        let cwd = cwd
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
        match cwd {
            Some(cwd) => {
                let changed = self.tab_cwds.get(&tab_position) != Some(&cwd);
                self.tab_cwds.insert(tab_position, cwd);
                changed
            }
            None => self.tab_cwds.remove(&tab_position).is_some(),
        }
    }

    fn tab_label(&self, tab: &TabInfo) -> String {
        let process = self.tab_processes.get(&tab.position).map(String::as_str);
        let cwd = self.tab_cwds.get(&tab.position).map(String::as_str);
        let name = (!tab.name.is_empty()).then_some(tab.name.as_str());
        let mut label = [process, cwd.or(name)]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(":");

        if label.is_empty() {
            label.push_str("Tab");
        }

        if tab.has_bell_notification || tab.is_flashing_bell {
            label.push('!');
        }

        label
    }

    fn tab_at(&self, column: usize) -> Option<usize> {
        self.hitboxes
            .iter()
            .find(|(start, end, _)| column >= *start && column < *end)
            .map(|(_, _, position)| *position)
    }
}

fn mode_text(mode_info: &ModeInfo, label: String) -> Text {
    let text = Text::new(label).opaque();

    match mode_info.mode {
        InputMode::Normal | InputMode::Move => text.color_all(2),
        InputMode::Locked => text.color_all(3),
        InputMode::Resize => text.color_all(0),
        InputMode::Pane | InputMode::Scroll => text.color_all(1),
        InputMode::Tmux => text.color_all(0),
        InputMode::Tab | InputMode::RenameTab | InputMode::RenamePane => text.error_color_all(),
        InputMode::EnterSearch | InputMode::Search | InputMode::Prompt | InputMode::Session => {
            text.color_all(0)
        }
    }
}

fn tab_text(tab: &TabInfo, label: String) -> Text {
    let text = Text::new(label);

    if tab.has_bell_notification || tab.is_flashing_bell {
        text.opaque().error_color_all()
    } else if tab.active {
        text.selected()
    } else {
        text.opaque()
    }
}

fn process_name(command: &[String]) -> Option<String> {
    let executable = command.first()?;
    Path::new(executable)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
}

fn truncate_to_width(value: &str, max_width: usize) -> String {
    if UnicodeWidthStr::width(value) <= max_width {
        return value.to_owned();
    }
    if max_width == 0 {
        return String::new();
    }

    let suffix = if max_width >= 3 { "..." } else { "" };
    let content_width = max_width - suffix.len();
    let mut result = String::new();
    let mut width = 0;

    for character in value.chars() {
        let character_width = UnicodeWidthChar::width(character).unwrap_or(0);
        if width + character_width > content_width {
            break;
        }
        result.push(character);
        width += character_width;
    }

    result.push_str(suffix);
    result
}
