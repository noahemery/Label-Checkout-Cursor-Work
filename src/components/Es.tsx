import type { ReactNode } from 'react';

/** Spanish line shown in parentheses under the English operator instruction. */
export function Es({ children }: { children: ReactNode }) {
  return (
    <span className="es" lang="es">
      ({children})
    </span>
  );
}
