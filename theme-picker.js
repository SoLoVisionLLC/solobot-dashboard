/**
 * SOLOBOT DASHBOARD - THEME PICKER
 * Apple-quality theme selection and persistence
 */

class ThemePicker {
    constructor() {
        this.currentTheme = this.getStoredTheme() || 'midnight';
        this.init();
    }

    init() {
        // Apply stored theme immediately
        this.applyTheme(this.currentTheme, false);
        
        // Setup theme card click handlers
        this.setupThemeCards();
        
        // Listen for external theme changes
        this.observeThemeChanges();
    }

    setupThemeCards() {
        const themeCards = document.querySelectorAll('.theme-card');
        
        themeCards.forEach(card => {
            const themeName = card.getAttribute('data-theme');
            if (!themeName) return;
            
            // Mark active theme
            if (themeName === this.currentTheme) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
            
            // Remove old listeners by cloning
            const newCard = card.cloneNode(true);
            card.parentNode.replaceChild(newCard, card);
            
            // Click handler
            newCard.addEventListener('click', () => {
                this.selectTheme(themeName);
            });
            
            // Preview on hover (optional - can be enabled for preview functionality)
            // Commented out by default for cleaner UX
            /*
            card.addEventListener('mouseenter', () => {
                this.previewTheme(themeName);
            });
            
            card.addEventListener('mouseleave', () => {
                this.applyTheme(this.currentTheme, false);
            });
            */
        });
    }

    selectTheme(themeName) {
        if (themeName === this.currentTheme) return;
        
        this.currentTheme = themeName;
        this.applyTheme(themeName, true);
        this.storeTheme(themeName);
        this.updateActiveCard();
        
        // Dispatch custom event for other parts of the app
        window.dispatchEvent(new CustomEvent('themeChanged', { 
            detail: { theme: themeName }
        }));
        
        // Update header theme icon if the function exists
        if (typeof updateThemeIcon === 'function') {
            updateThemeIcon(themeName);
        }
    }

    applyTheme(themeName, animated = true) {
        const html = document.documentElement;
        
        // Add transition class for smooth animation
        if (animated) {
            document.body.classList.add('theme-transitioning');
        }
        
        // Set the theme
        html.setAttribute('data-theme', themeName);
        
        // Remove transition class after animation completes
        if (animated) {
            setTimeout(() => {
                document.body.classList.remove('theme-transitioning');
            }, 300);
        }
    }

    previewTheme(themeName) {
        // For hover preview (optional)
        this.applyTheme(themeName, true);
    }

    updateActiveCard() {
        const themeCards = document.querySelectorAll('.theme-card');
        
        themeCards.forEach(card => {
            const themeName = card.getAttribute('data-theme');
            
            if (themeName === this.currentTheme) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });
    }

    storeTheme(themeName) {
        try {
            localStorage.setItem('solobot-theme', themeName);
        } catch (e) {
            console.warn('Failed to store theme preference:', e);
        }
    }

    getStoredTheme() {
        try {
            return localStorage.getItem('solobot-theme');
        } catch (e) {
            console.warn('Failed to get stored theme:', e);
            return null;
        }
    }

    observeThemeChanges() {
        // Observe changes to data-theme attribute (in case changed elsewhere)
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
                    const newTheme = document.documentElement.getAttribute('data-theme');
                    if (newTheme && newTheme !== this.currentTheme) {
                        this.currentTheme = newTheme;
                        this.updateActiveCard();
                    }
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
    }

    // Public API for programmatic theme changes
    setTheme(themeName) {
        this.selectTheme(themeName);
    }

    getTheme() {
        return this.currentTheme;
    }

    getAvailableThemes() {
        return {
            dark: [
                'midnight',
                'obsidian',
                'nord',
                'dracula',
                'tokyo-night',
                'monokai',
                'catppuccin-mocha'
            ],
            light: [
                'snow',
                'latte',
                'rose-pine-dawn',
                'solarized-light',
                'paper'
            ],
            special: [
                'solovision-red',
                'cyberpunk',
                'ocean'
            ]
        };
    }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.themePicker = new ThemePicker();
    });
} else {
    // DOM already loaded
    window.themePicker = new ThemePicker();
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThemePicker;
}
