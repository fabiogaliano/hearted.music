// Password managers (Bitwarden, 1Password, LastPass) aggressively offer to
// autofill any text/email input. This panel's fields are never credentials, so
// we opt every input out: `autocomplete="off"` plus each manager's own ignore
// attribute. Spread onto an <input>/<textarea>/<select>.
export const noAutofill = {
	autoComplete: "off",
	"data-1p-ignore": "true",
	"data-lpignore": "true",
	"data-bwignore": "true",
	"data-form-type": "other",
} as const;
