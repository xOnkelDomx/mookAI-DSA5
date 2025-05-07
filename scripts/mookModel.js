/*
The MookModel is an abstraction of system- and user-specific information:
its intended purpose is to hold all the messy bits so that the code above it
doesn't have to handle a bunch of edge cases.

When this work is complete (or as complete as any coding project can be...),
there will be various configuration settings that change how mooks behave.
For example, there might be a CowardlyMook who avoids mele combat, a
TattleTaleMook who goes to find reinforcements, a BerserkerMook with a tunnel
vision and no range, a FlyingMook, a KitingMook etc. The ultimate goal is to
generate these mooks from a configuration file, but that's a long ways off.

Let me reiterate that full autonomy is not within the scope of this project.
mookAI is intended to automate low-threat enemies, and while it is possible to
construct complex AIs, overreliance on this module will lead to TPKs and other
negative experiences (such as executing downed characters) for your players.
This module does not free the GM of responsibility of combat outcomes. Like any
tool, its usage is at the discretion of the practitioner.

The goal for this class is to implement different subclasses for systems other than DnD5e. This process is relatively simple, as only few methods need to be overridden. The ultimate aim is that the system-specific model plugs in below this abstraction layer.
*/

import { MookModelSettings, MookInitiative } from "./mookModelSettings.js";
import { MookModelDSA5 } from "./mookDSA5.js";
import { debugLog } from "./behaviors.js";

/*
Actions are objects that contain:
1) ActionType
2) Cost (in units of "time")
3) Data
Actions of ActionType 0-9 are provided by the base MookModel, and these functions should not be overloaded
Actions of ActionType 10+ are handled by system-specific MookModels.
*/
export const ActionType = {
	HALT: 0,
	SENSE: 1,
	PLAN: 2,
	ROTATE: 3,
	FACE: 4,
	MOVE: 5, // unused
	STEP: 6,
	TRAVERSE: 7,
	EXPLORE: 8,
	TARGET: 9,
	ZOOM: 10,
	ATTACK: 11,
	CAST: 12
};

class Ability {
	constructor(type_, data_) {
		this.type = type_;
		this.data = data_;
		this.used = false;

		if (this.data.recharge === undefined)
			this.data.recharge = obj_ => { obj_.used = false; };
	}

	act(data_) {
		if (!this.can()) return null;
		this.used = true;
		return this.data.act?.(data_) ?? null;
	}
	can() { return !this.used; }
	recharge() { this.data.recharge(this); }
}

export class MookModel {
	constructor(token_, settings_) {
		if (!token_) throw new Error("mookAI | MookModel requires a token.");
		this._movedTiles = 0;
		this.settings = settings_;
		this._token = token_;
		this._actions = [];
		this._targetHistory = [];

		this.attacksRemaining = 0;
		this.zoomsRemaining = 0;
	}

	// This static method returns the model for the token.
	static getMookModel(token_, ...args_) {
		const system = game.system.id.toLowerCase();
		if (system !== "dsa5") throw new Error(`mookAI | Unsupported system: ${system}`);
		debugLog(`Creating MookModelDSA5 for token ${token_.name}`);
		return new MookModelDSA5(token_, new MookModelSettings(token_), ...args_);
	}

	// Do not override these
	async attack(action_) { this._attack(action_); }
	haltAction() { return { actionType: ActionType.HALT, cost: 0 }; }
	senseAction() { return { actionType: ActionType.SENSE, cost: 0 }; }
	planAction() { return { actionType: ActionType.PLAN, cost: 0 }; }
	rotateAction(deg_) {
		return {
			actionType: ActionType.ROTATE,
			cost: this.settings.rotationCost,
			data: deg_
		};
	}
	stepAction() { return { actionType: ActionType.STEP, cost: 1 }; }
	faceAction(token_) { return { actionType: ActionType.FACE, data: token_ }; }
	meleAttackAction() { return { actionType: ActionType.ATTACK, data: { weapon: this.meleWeapon }}; }
	rangedAttackAction() { return { actionType: ActionType.ATTACK, data: { weapon: this.rangedWeapon }}; }
	randomRotateAction() { return this.rotateAction(45 * (Math.random() > 0.5 ? 1 : -1)); }

	// Start of round
	startTurn() {
		this._movedTiles = 0;
		this.resetResources();
		this._startTurn();
	}
	resetResources() { this._resetResources(); }

	// Optional fallback logic when idle
	exploreActions() {
		debugLog("Debug M1: Getting explore actions", {
			mookInitiative: this.settings.mookInitiative,
			MookInitiative: MookInitiative
		});

		let ret = [];

		switch (this.settings.mookInitiative) {
			case MookInitiative.DO_NOTHING:
				ret.push(this.haltAction());
				break;
			case MookInitiative.ROTATE:
				ret.push(this.randomRotateAction());
				break;
			case MookInitiative.CREEP:
				ret.push(this.stepAction());
				break;
			case MookInitiative.WANDER:
				ret.push(this.randomRotateAction());
				ret.push(this.stepAction());
				break;
			default:
				console.warn("Debug M6: Unknown initiative type:", this.settings.mookInitiative);
				ret.push(this.haltAction());
		}

		debugLog("Debug M7: Returning explore actions:", ret);
		return ret;
	}

	// Must be implemented in subclass
	_attack(action_) { throw "mookAI | Abstract '_attack' must be implemented by system model."; }
	_resetResources() {}
	_startTurn() {}
	zoom() { return this.time; }

	recordMovement(tiles) {
		this._movedTiles += tiles;
	}

	// --- Getters ---
	get gridDistance() { return game.scenes.active.grid.distance; }
	get token() { return this._token; }

	get hasSight() { return this.token.hasSight; }
	get hasVision() { return this.settings.useSight && this.hasSight; }
	get hasMele() { return this.settings.useMele && this._hasMele; }
	get hasRanged() { return this.settings.useRanged && this._hasRanged; }

	get meleWeapon() { return this.hasMele ? this.meleWeapons[0] : null; }
	get rangedWeapon() { return this.hasRanged ? this.rangedWeapons[0] : null; }

	get canAttack() { return this.attacksRemaining > 0; }
	get canZoom() { return this.zoomsRemaining > 0; }

	addTarget(target_) { this._targetHistory.push(target_); }
	get firstTarget() { return this._targetHistory[0] ?? null; }
	get lastTarget() { return this._targetHistory[this._targetHistory.length - 1] ?? null; }
	get targetHistory() { return this._targetHistory; }

	getHealthPercent(token_ = this.token) {
		return this.getCurrentHealth(token_) / this.getMaxHealth(token_);
	}

	// Abstract: must be implemented in DSA5 subclass
	get meleRange() { throw "mookAI | 'meleRange' must be implemented in subclass."; }
	get rangedRange() { throw "mookAI | 'rangedRange' must be implemented in subclass."; }
	getCurrentHealth(token_) { throw "mookAI | 'getCurrentHealth' must be implemented in subclass."; }
	getMaxHealth(token_) { throw "mookAI | 'getMaxHealth' must be implemented in subclass."; }
	get time() { throw "mookAI | 'time' must be implemented in subclass."; }
}
