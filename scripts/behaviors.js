/**
 * Output debug logs if debug is enabled in settings.
 */
export function debugLog(...args) {
	const MODULE_ID = "mookAI-DSA5";
	if (game.settings?.get(MODULE_ID, "EnableDebug")) {
		console.log("mookAI [DEBUG]:", ...args);
	}
}

// Different types of Mooks the AI can use (affects behavior model)
export const MookTypes = {
	DEFAULT: 0,
	BERSERKER: 1,
	COWARD: 2,
	TATTLETALE: 3
};

/**
 * Get the MookType enum from the saved setting value.
 * @param {number|string} typeSetting - Value from game.settings
 * @returns {number} - Enum value from MookTypes
 */
export function getMookType(typeSetting) {
	const numValue = parseInt(typeSetting);
	for (const [key, val] of Object.entries(MookTypes)) {
		if (val === numValue) return val;
	}
	console.warn("mookAI | Invalid MookType setting:", typeSetting);
	return MookTypes.DEFAULT;
}
