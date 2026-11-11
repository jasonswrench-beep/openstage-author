// Every key the editor has, in one list: shown by Help > Keyboard keys (Ctrl+/) and by the Keys button under the slide, which took
// the place of the paragraph of keys that used to sit there. The same keys are in the table at the end of docs/editor.md, and a test
// (keys.test.ts) checks that every shortcut in design/icons.json is here.

export interface KeyRow {
  keys: string;
  does: string;
}

export interface KeyGroup {
  id: string;
  title: string;
  rows: KeyRow[];
}

export const KEY_GROUPS: readonly KeyGroup[] = [
  {
    id: "anywhere",
    title: "Anywhere",
    rows: [
      { keys: "Ctrl+K", does: "Search for a command by its name" },
      { keys: "Ctrl+/", does: "This list of keys" },
      { keys: "Ctrl+J", does: "Go to a slide, found by its name or its number" },
      { keys: "F10, or Alt pressed and let go on its own", does: "Go to the menus, and pressed again, back to where you were" },
      { keys: "F6, Shift+F6", does: "Go to the next or the previous part of the window" },
      { keys: "Ctrl+N", does: "New project" },
      { keys: "Ctrl+O", does: "Open a project" },
      { keys: "Ctrl+S", does: "Save" },
      { keys: "Ctrl+Z", does: "Undo" },
      { keys: "Ctrl+Y, or Ctrl+Shift+Z", does: "Redo" },
      { keys: "Ctrl+P", does: "Preview" },
      { keys: "Ctrl+Shift+P", does: "Publish" },
    ],
  },
  {
    id: "canvas",
    title: "On the slide",
    rows: [
      { keys: "Arrow keys", does: "Move the selected objects by 1, or by 10 with Shift" },
      { keys: "Alt+arrow keys", does: "Resize one object, or one whole group" },
      { keys: "Page Down, Page Up", does: "Select the next or the previous object; with Shift, add it to the selection" },
      { keys: "Shift and click", does: "Add an object to the selection, or take it out" },
      { keys: "Drag a box round objects", does: "Select them" },
      { keys: "Alt and click", does: "Choose just that object, when it is in a group (a click chooses the whole group)" },
      { keys: "Alt while dragging", does: "Drag freely, without snapping to the slide's edges and middle and to other objects (the Snap button turns snapping off for every drag)" },
      { keys: "F2, or a double click", does: "Edit the words of the selected text" },
      { keys: "Shift+F10, or the Menu key", does: "Open the menu for what is selected, the same as a right-click" },
      { keys: "Delete", does: "Delete the selected objects" },
      { keys: "Escape", does: "Clear the selection" },
    ],
  },
  {
    id: "objects",
    title: "The selected objects (not while typing in a box)",
    rows: [
      { keys: "Ctrl+C, Ctrl+X, Ctrl+V", does: "Copy, cut and paste" },
      { keys: "Ctrl+D", does: "Duplicate (in the list of slides, duplicate the slide)" },
      { keys: "Ctrl+A", does: "Select every object on the layer" },
      { keys: "Ctrl+L", does: "Lock or unlock" },
      { keys: "Ctrl+G", does: "Group" },
      { keys: "Ctrl+Shift+G", does: "Ungroup" },
    ],
  },
  {
    id: "lists",
    title: "The lists of slides, objects and problems",
    rows: [
      { keys: "Up, Down, Home, End", does: "Move along the list" },
      { keys: "Enter or Space", does: "Choose" },
      { keys: "Shift+F10, or the Menu key", does: "Open the menu for the slide, the section or the object, the same as a right-click" },
      { keys: "Alt+Up, Alt+Down", does: "In the slides, move the slide earlier or later (at the edge of a section, into the next one), or on a section's name, move the whole section; in the objects, move the object earlier or later in reading order, which is also the tab order" },
      { keys: "Right, Left", does: "In the slides, on a section's name, open or close the section; Left on a slide goes to its section's name" },
      { keys: "Delete", does: "Delete the slide, or the object (and all the selected objects, if it is one of them)" },
      { keys: "Shift with Up, Down, Home or End", does: "In the objects, select a run of them" },
      { keys: "Ctrl+Space", does: "In the objects, add the object to the selection, or take it out" },
    ],
  },
  {
    id: "menus",
    title: "Menus, and the Add and ... buttons",
    rows: [
      { keys: "Left, Right", does: "Move along the menus, or open the menu beside this one" },
      { keys: "Down, Enter or Space", does: "Open a menu on its first item (Up opens it on its last)" },
      { keys: "Up, Down, Home, End", does: "Move in a menu" },
      { keys: "A letter", does: "Go to the next item that starts with it" },
      { keys: "Enter", does: "Choose the item" },
      { keys: "Escape", does: "Close the menu and go back to where you were" },
      { keys: "Tab", does: "Close the menu" },
    ],
  },
  {
    id: "search",
    title: "Search for a command (Ctrl+K)",
    rows: [
      { keys: "Type", does: "Find the commands whose names have those words" },
      { keys: "Up, Down, Page Up, Page Down", does: "Move through what is found" },
      { keys: "Enter", does: "Do the command" },
      { keys: "Escape", does: "Close the search" },
    ],
  },
  {
    id: "gallery",
    title: "Find something to add (Insert menu, and the Add menus)",
    rows: [
      { keys: "Type", does: "Find what you can add by its name, its kind or what it is for" },
      { keys: "Down", does: "From the search box to the first choice" },
      { keys: "Arrow keys, Home, End", does: "Move between the choices; Up from the first goes back to the search box" },
      { keys: "Enter or Space", does: "Add the choice, as its menu would" },
      { keys: "Tab", does: "On to the row of kinds (the arrow keys choose one), then to Cancel" },
      { keys: "Escape", does: "Close it; in any dialog, Escape does what its Close button does" },
    ],
  },
  {
    id: "text",
    title: "The Edit text window",
    rows: [
      { keys: "Ctrl+B, Ctrl+I, Ctrl+U", does: "Bold, italic, underline" },
      { keys: "Ctrl+K", does: "Make a link (in this window, Ctrl+K does not open the search)" },
      { keys: "Left, Right, Home, End", does: "Move along the toolbar, which is one tab stop" },
      { keys: "Escape", does: "Close, asking first if there are changes" },
    ],
  },
];

/** The same groups, with one of them first (the slide's, when the list is opened from the Keys button under the slide). */
export function keyGroupsFirst(first?: string): KeyGroup[] {
  const at = KEY_GROUPS.findIndex((g) => g.id === first);
  if (at <= 0) return [...KEY_GROUPS];
  return [KEY_GROUPS[at]!, ...KEY_GROUPS.slice(0, at), ...KEY_GROUPS.slice(at + 1)];
}

/**
 * What a screen reader says about the slide when it gets focus: the keys used most, and where to find the rest. It used to be the
 * whole paragraph of keys, read every time.
 */
export const CANVAS_DESCRIPTION =
  "Arrow keys move the selected objects, and Alt with arrow keys resizes. Page Down and Page Up select the next or previous object. " +
  "F2 edits the words of a text. Shift+F10 opens the menu. Ctrl+/ lists every key.";
