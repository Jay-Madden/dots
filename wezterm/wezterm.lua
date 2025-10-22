local wezterm = require("wezterm")

local config = wezterm.config_builder()

config.default_cursor_style = "SteadyBar"

local custom_kanagawa = wezterm.color.get_builtin_schemes()["Kanagawa (Gogh)"]
-- Make the green accept color slightly brighter then the default theme
custom_kanagawa.ansi[3] = "#9eb974"

config.color_schemes = {
  ["custom-kanagawa"] = custom_kanagawa,
}
config.color_scheme = "custom-kanagawa"

local font_name = "JetBrainsMono Nerd Font Mono"
config.font = wezterm.font_with_fallback({
  {
    family = font_name,
    weight = "Bold",
    italic = false,
    harfbuzz_features = {"calt=0", "clig=0", "liga=0"},
  },
  "Apple Color Emoji",
})

config.cell_width = 1.01
config.font_size = 13

config.custom_block_glyphs = true
config.underline_thickness = "1.5pt"

config.window_padding = {
  left = 5,
  right = 5,
  top = 0,
  bottom = 1,
}

config.window_background_opacity = 1.0
config.window_decorations = "TITLE|RESIZE|MACOS_USE_BACKGROUND_COLOR_AS_TITLEBAR_COLOR"

config.front_end = "WebGpu"
config.animation_fps = 240
config.max_fps = 240

local mux = wezterm.mux
wezterm.on("gui-startup", function(cmd)
  local _, _, window = mux.spawn_window(cmd or {})
  window:gui_window():maximize()
end)

-- Create the "focus window" hot key mappings
config.keys = {}
for i = 1, 8 do
  table.insert(config.keys, {
    key = tostring(i),
    mods = "ALT",
    action = wezterm.action.ActivateWindow(i - 1),
  })
end

-- Put the window id in the status bar so that we know where to jump
wezterm.on('format-window-title', function(tab, pane, tabs, panes, config)
  for i, win in ipairs(wezterm.gui.gui_windows()) do
    -- get the index of the window that contains the id we want, thats what we can pass to ActivateWindow
    if win:window_id() == tab.window_id then
       return i
    end
  end
end)

config.show_tabs_in_tab_bar = false
config.show_tab_index_in_tab_bar = false
config.hide_tab_bar_if_only_one_tab = true
config.show_new_tab_button_in_tab_bar = false

-- Returns our config to be evaluated. We must always do this at the bottom of this file
return config
