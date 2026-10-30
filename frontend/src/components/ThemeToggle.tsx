import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../theme/ThemeProvider';
import { IconButton } from './ui';

export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  return (
    <IconButton
      label={resolved === 'dark' ? 'Chuyển giao diện sáng' : 'Chuyển giao diện tối'}
      onClick={toggle}
    >
      {resolved === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </IconButton>
  );
}
