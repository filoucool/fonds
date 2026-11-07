export const THEME_STORAGE_KEY = 'archiver.theme';

export const THEMES = [
  {
    id: 'reading-room',
    name: 'Reading room',
    description: 'Olive walls and a brass lamp. The night stacks.',
    scheme: 'dark',
  },
  {
    id: 'noctua',
    name: 'Noctua',
    description: 'Beige and brown, the color of the fans.',
    scheme: 'light',
  },
  {
    id: 'card-catalog',
    name: 'Card catalog',
    description: 'Aged paper, oak drawers, and oxblood ink.',
    scheme: 'light',
  },
  {
    id: 'green-shade',
    name: 'Green shade',
    description: 'Dark leather and gilt under a banker’s lamp.',
    scheme: 'dark',
  },
  {
    id: 'morocco',
    name: 'Morocco',
    description: 'Oxblood bindings with a worn gold edge.',
    scheme: 'dark',
  },
  {
    id: 'blue-buckram',
    name: 'Blue buckram',
    description: 'Faded library cloth and dull gilt.',
    scheme: 'dark',
  },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const THEME_IDS: ReadonlySet<string> = new Set(THEMES.map((theme) => theme.id));

export function isThemeId(value: string | null): value is ThemeId {
  return value !== null && THEME_IDS.has(value);
}

export function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    // Private browsing can refuse storage. Keep the default reading room.
  }
  return 'reading-room';
}

export function applyTheme(id: ThemeId): void {
  const theme = THEMES.find((item) => item.id === id) ?? THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.colorScheme = theme.scheme;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', theme.scheme);
}

export function saveTheme(id: ThemeId): void {
  applyTheme(id);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // The theme still applies for this visit.
  }
}
