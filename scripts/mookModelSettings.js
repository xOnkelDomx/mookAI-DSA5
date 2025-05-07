import { MookTypes, getMookType, debugLog } from "./behaviors.js";
import { Mook } from "./mook.js";

// Controls what a mook does when there are no viable targets
export const MookInitiative = {
	DO_NOTHING: 0,   // Mook ends their turn
	ROTATE: 1,       // Mook spins in place randomly
	CREEP: 2,        // Mook moves in a line
	WANDER: 3        // Mook spins and steps randomly
};

// Add a helper function to convert numeric setting to enum value
function getMookInitiativeFromSetting(value) {
	const numValue = parseInt(value);
	for (const [key, val] of Object.entries(MookInitiative)) {
		if (val === numValue) {
			debugLog(`Debug: Converting initiative setting ${value} to ${key}`);
			return MookInitiative[key];
		}
	}
	console.warn(`Invalid MookInitiative value: ${value}, defaulting to CREEP`);
	return MookInitiative.CREEP;
}

export class MookModelSettings {
	constructor(token_) {
		const actor = token_.actor;

		// Get settings from the module
		const MODULE_ID = "mookAI-DSA5";

		this.mookType = getMookType(game.settings.get(MODULE_ID, "MookType"));

		this.useAI = "true";

		this.useMele = game.settings.get(MODULE_ID, "UseMele");
		this.useRanged = game.settings.get(MODULE_ID, "UseRanged");
		this.useSight = game.settings.get(MODULE_ID, "UseVision");
		this.rotationCost = game.settings.get(MODULE_ID, "RotationCost");

		const initiativeValue = game.settings.get(MODULE_ID, "MookInitiative");
		debugLog("Debug: Got initiative setting", initiativeValue);
		this.mookInitiative = getMookInitiativeFromSetting(initiativeValue);
		debugLog("Debug: Set mookInitiative to", this.mookInitiative);

		if (this.mookInitiative === MookInitiative.ROTATE && this.rotationCost === 0)
			this.mookInitiative = MookInitiative.DO_NOTHING;

		if (this.rotationCost < 0) this.rotationCost = 0;
		if (this.rotationCost > 1) this.rotationCost = 1;

		this.faction = "hostile";
		this.attackable = "true";

		this.standardMeleWeaponTileRange = game.settings.get(MODULE_ID, "StandardMeleTileRange");
		if (this.standardMeleWeaponTileRange < 0) this.standardMeleWeaponTileRange = 1;

		this.standardRangedWeaponTileRange = game.settings.get(MODULE_ID, "StandardRangedTileRange");
		if (this.standardRangedWeaponTileRange < 0) this.standardRangedWeaponTileRange = 12;

		// Future vision settings:
		// this.visionAngle = 360;
		// this.visionRange = Infinity;
	}
}
