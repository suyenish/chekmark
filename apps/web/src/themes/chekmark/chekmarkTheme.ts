import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

/**
 * Chekmark's look on top of Astryx's neutral theme: book paper, graphite and
 * the yellow of an HB pencil. Every value is a [light, dark] pair. The fonts
 * are bundled with the app (see main.tsx), so the theme names them without a URL.
 */
const UI_FONT = { family: 'IBM Plex Sans KR', fallbacks: "system-ui, -apple-system, 'Apple SD Gothic Neo', sans-serif" };

export const chekmarkTheme = defineTheme({
  name: 'chekmark',
  extends: neutralTheme,
  typography: {
    scale: { base: 16, ratio: 1.2 },
    body: UI_FONT,
    heading: UI_FONT,
  },
  radius: { base: 8, multiplier: 1 },
  tokens: {
    // Paper and graphite.
    '--color-background-body': ['#edefea', '#1b1d1e'],
    '--color-background-surface': ['#f6f7f4', '#26292b'],
    '--color-background-card': ['#f6f7f4', '#232628'],
    '--color-background-popover': ['#fbfbf9', '#2b2e30'],
    '--color-background-muted': ['#e3e6df', '#2b2e30'],
    '--color-text-primary': ['#26292b', '#eceee9'],
    '--color-text-secondary': ['#5c6064', '#a9adb0'],
    '--color-icon-primary': ['#26292b', '#eceee9'],
    '--color-icon-secondary': ['#5c6064', '#a9adb0'],
    '--color-border': ['#26292b1f', '#eceee926'],
    '--color-border-emphasized': ['#b9beb6', '#5c6064'],
    '--color-skeleton': ['#e0e3dc', '#34383a'],
    // Pencil yellow for the one main action; graphite text on it in both modes.
    '--color-accent': ['#f2b21b', '#f2b21b'],
    '--color-on-accent': ['#26292b', '#1b1d1e'],
    '--color-accent-muted': ['#f7dc94', '#5a4712'],
    '--color-text-accent': ['#6b4d00', '#f2c75a'],
    '--color-icon-accent': ['#8a6400', '#f2c75a'],
  },
  // The app's own colours, for the pencil marks drawn under Korean text.
  localTokens: {
    '--mark-graphite': ['#26292b', '#eceee9'],
    '--mark-ink': ['#2e5a88', '#8ab4e8'],
    '--mark-eraser': ['#c9576a', '#f08a9b'],
    '--mark-highlight': ['#f2b21b8c', '#f2b21b59'],
    '--font-family-book': "'Gowun Batang', 'Nanum Myeongjo', 'AppleMyungjo', serif",
  },
});
