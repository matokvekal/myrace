import { useState, useEffect } from 'react';

// Button "skin" — purely visual restyle of buttons, independent of color theme.
// 'classic' = the app's default button design (no overrides applied).
// 'gaming'  = arcade-style restyle (see [data-skin="gaming"] in globals.css).
export type Skin = 'classic' | 'gaming';
const KEY = 'app-skin';
const VALID: Skin[] = ['classic', 'gaming'];

export function useSkin() {
  const [skin, setSkinState] = useState<Skin>(() => {
    const stored = localStorage.getItem(KEY) as Skin;
    return VALID.includes(stored) ? stored : 'classic';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-skin', skin);
    localStorage.setItem(KEY, skin);
  }, [skin]);

  const setSkin = (s: Skin) => setSkinState(s);
  const toggleSkin = () => setSkinState(s => (s === 'classic' ? 'gaming' : 'classic'));

  return { skin, setSkin, toggleSkin };
}
