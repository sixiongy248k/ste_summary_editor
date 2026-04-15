/**
 * Tailwind CDN configuration for Summary Editor.
 * Uses `se-` prefix to avoid conflicts with SillyTavern's base styles.
 */
export function configureTailwind() {
    if (!window.tailwind) return;

    window.tailwind.config = {
        prefix: 'se-',
        darkMode: 'class',
        corePlugins: {
            preflight: false, // Don't reset ST's base styles
        },
        theme: {
            extend: {
                colors: {
                    monokai: {
                        bg: '#272822',
                        fg: '#f8f8f2',
                        green: '#a6e22e',
                        cyan: '#66d9e8',
                        pink: '#f92672',
                        orange: '#fd971f',
                        yellow: '#e6db74',
                        purple: '#ae81ff',
                        comment: '#75715e',
                        line: '#3e3d32',
                    },
                },
                fontFamily: {
                    mono: ['Source Code Pro', 'Fira Code', 'monospace'],
                },
            },
        },
    };
}
