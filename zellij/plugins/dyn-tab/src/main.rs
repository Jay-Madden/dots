use std::{collections::HashMap, path::Path};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};
use zellij_tile::prelude::*;

#[derive(Default, Debug)]
struct ViewPane {
    pane: PaneInfo,
    cwd: String,
    process: String,
}

#[derive(Default, Debug)]
struct ViewTab {
    tab: TabInfo,
    col: usize,
    width: usize,
    panes: Vec<ViewPane>,
}

#[derive(Default)]
struct TabBar {
    mode_info: Option<ModeInfo>,
    tabs: Vec<ViewTab>,
    plugin_id: u32,
    client_id: ClientId,
}

register_plugin!(TabBar);

impl ZellijPlugin for TabBar {
    fn load(&mut self, _configuration: std::collections::BTreeMap<String, String>) {
        let ids = get_plugin_ids();
        self.plugin_id = ids.plugin_id;
        self.client_id = ids.client_id;

        // This needs to be true on initial load so the permission prompt can be accepted
        set_selectable(true);

        subscribe(&[
            EventType::ModeUpdate,
            EventType::SessionUpdate,
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
                self.mode_info = Some(mode_info);
                true
            }
            Event::SessionUpdate(sessions, _) => {
                // eprintln!("SessionUpdate recieved: ",);
                let Some(session) = sessions
                    .into_iter()
                    .find(|session| session.is_current_session)
                else {
                    return false;
                };

                eprintln!("SessionUpdate for current session recieved: ");

                self.set_state_from_session(session);
                true
            }
            Event::CommandChanged(pane_id, command, is_foreground, _) => {
                let process = if is_foreground && !self.is_shell_command(&command) {
                    process_name(&command).unwrap_or_default()
                } else {
                    String::new()
                };
                let Some(view_pane) = self.get_view_pane_mut(pane_id) else {
                    return false;
                };
                let changed = view_pane.process != process;
                view_pane.process = process;

                changed && view_pane.pane.is_focused
            }
            Event::CwdChanged(pane_id, cwd, _) => {
                let Some(view_pane) = self.get_view_pane_mut(pane_id) else {
                    return false;
                };

                let cwd = cwd
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| cwd.to_string_lossy().into_owned());

                let changed = view_pane.cwd != cwd;
                view_pane.cwd = cwd;

                changed && view_pane.pane.is_focused
            }
            Event::PermissionRequestResult(PermissionStatus::Granted) => {
                set_selectable(false);
                false
            }
            Event::Mouse(Mouse::LeftClick(_, column)) => {
                if let Some(tab_position) = self.tab_at(column) {
                    go_to_tab(tab_position);
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

        let mut output = String::new();
        let mut used = 0;

        if let Some(mode_info) = &self.mode_info {
            let label = truncate_to_width(&format!(" {:?} ", mode_info.mode).to_uppercase(), cols);
            let width = UnicodeWidthStr::width(label.as_str());
            output.push_str(&serialize_text(&mode_text(mode_info, label)));
            used += width;
        } else {
            output.push_str(&serialize_text(&Text::new("Unknown").opaque()));
        }

        for tab_view in &mut self.tabs {
            if used >= cols {
                eprintln!("No more space for tabs, used: {used}, cols: {cols}");
                break;
            }

            // 4 padding for the arrows in the font
            const ARROW_PADDING: usize = 4;

            let available_width = cols.saturating_sub(used + ARROW_PADDING);
            let label = tab_label(tab_view);
            let label = truncate_to_width(label.as_str(), available_width);
            let label_width = UnicodeWidthStr::width(label.as_str());
            if label_width == 0 {
                break;
            }
            let width = label_width + ARROW_PADDING;

            tab_view.col = used;
            tab_view.width = width;

            // The session event is global so we need to make sure the current tab is also active
            // with the currently attached client
            let active = tab_view
                .tab
                .other_focused_clients
                .contains(&self.client_id);

            output.push_str(&serialize_ribbon(&tab_text(
                &tab_view.tab,
                active,
                label,
            )));
            used += width;
        }

        if used < cols {
            output.push_str(&serialize_text(
                &Text::new(" ".repeat(cols - used)).opaque(),
            ));
        }

        eprintln!("Rendered tab bar: {output}");
        print!("{output}");
    }
}

impl TabBar {
    fn set_state_from_session(&mut self, mut session: SessionInfo) {
        // If the plugin pane is the only one left in the tab then its been closed
        // and we should kill ourselves
        let should_destroy_self = session.tabs.iter().any(|tab| {
            let panes = session
                .panes
                .panes
                .get(&tab.position)
                .map(Vec::as_slice)
                .unwrap_or_default();
            let contains_self = panes
                .iter()
                .any(|pane| pane.is_plugin && pane.id == self.plugin_id);
            let has_terminal = panes
                .iter()
                .any(|pane| !pane.is_plugin && !pane.is_suppressed);

            contains_self && !has_terminal
        });

        if should_destroy_self {
            close_self();
            return;
        }

        // Keep tabs in their current display order.
        session.tabs.sort_by_key(|tab| tab.position);

        // Cache the shell name so initial process lookups can exclude it.
        let shell = self.shell_name();

        // Index existing tabs so their cached view state survives updates.
        let mut cached_tabs: HashMap<usize, ViewTab> = std::mem::take(&mut self.tabs)
            .into_iter()
            .map(|tab| (tab.tab.tab_id, tab))
            .collect();

        // Rebuild the visible tabs from the latest session snapshot.
        self.tabs = session
            .tabs
            .into_iter()
            .map(|session_tab| {
                // Reuse the cached tab when its id is still there
                let mut view_tab = cached_tabs.remove(&session_tab.tab_id).unwrap_or_default();

                // Index terminal panes so their cached state survives updates
                let mut cached_panes: HashMap<PaneId, ViewPane> =
                    std::mem::take(&mut view_tab.panes)
                        .into_iter()
                        .map(|pane| (PaneId::Terminal(pane.pane.id), pane))
                        .collect();

                // Rebuild terminal panes
                view_tab.panes = session
                    .panes
                    .panes
                    .get(&session_tab.position)
                    .into_iter()
                    .flatten()
                    .filter(|pane| !pane.is_plugin)
                    .cloned()
                    .map(|pane| {
                        // Reuse cached per-pane state or initialize it from the server.
                        let pane_id = PaneId::Terminal(pane.id);
                        let mut view_pane = cached_panes.remove(&pane_id).unwrap_or_else(|| {
                            // Load the panes cwd only if weve never seen it before (initial load)
                            let cwd = get_pane_cwd(pane_id)
                                .ok()
                                .and_then(|cwd| {
                                    cwd.file_name()
                                        .map(|name| name.to_string_lossy().into_owned())
                                })
                                .unwrap_or_default();

                            // Load the process only if we have never seen the pane before.
                            let process = if let Some(shell) = shell.as_deref() {
                                get_pane_running_command(pane_id)
                                    .ok()
                                    .and_then(|command| process_name(&command))
                                    .filter(|process| process != shell)
                                    .unwrap_or_default()
                            } else {
                                String::new()
                            };

                            ViewPane {
                                cwd,
                                process,
                                ..Default::default()
                            }
                        });
                        view_pane.pane = pane;
                        view_pane
                    })
                    .collect();

                // Refresh tab metadata while retaining view state
                view_tab.tab = session_tab;
                view_tab
            })
            .collect();
    }

    fn shell_name(&self) -> Option<String> {
        self.mode_info
            .as_ref()
            .and_then(|mode_info| mode_info.shell.as_ref())
            .and_then(|shell| shell.file_name())
            .and_then(|shell| shell.to_str())
            .map(str::to_owned)
    }

    fn is_shell_command(&self, command: &[String]) -> bool {
        let Some(process) = process_name(command) else {
            return false;
        };

        self.shell_name().as_deref() == Some(process.as_str())
    }

    fn get_view_pane_mut(&mut self, pane_id: PaneId) -> Option<&mut ViewPane> {
        self.tabs
            .iter_mut()
            .flat_map(|tab| tab.panes.iter_mut())
            .find(|pane| PaneId::Terminal(pane.pane.id) == pane_id)
    }

    fn tab_at(&self, idx: usize) -> Option<u32> {
        for tab_view in &self.tabs {
            if idx >= tab_view.col && idx < tab_view.col + tab_view.width {
                return Some(tab_view.tab.position as u32);
            }
        }
        None
    }
}

fn tab_label(tab: &ViewTab) -> String {
    let Some(pane) = tab.panes.iter().find(|pane| pane.pane.is_focused) else {
        return tab.tab.name.clone();
    };
    let label = [pane.process.as_str(), pane.cwd.as_str()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(":");

    if label.is_empty() {
        tab.tab.name.clone()
    } else {
        label
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

fn tab_text(tab: &TabInfo, active: bool, label: String) -> Text {
    let text = Text::new(label);

    if tab.has_bell_notification || tab.is_flashing_bell {
        text.opaque().error_color_all()
    } else if active {
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
