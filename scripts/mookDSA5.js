import { MookModel } from "./mookModel.js";
import { MookModelSettings } from "./mookModelSettings.js";
import { debugLog } from "./behaviors.js";

/**
 * DSA5-spezifisches MookModel
 */
class MookModelDSA5 extends MookModel {
	constructor(token_, settings_, ...args_) {
		super(token_, settings_);
		this.actionsRemaining = 1;
	}

	chooseTarget() {
		const token = this.token;
		if (token.document.disposition !== -1) return null;

		const targets = canvas.tokens.placeables.filter(t =>
			t.actor &&
			t.document.disposition === 1 &&
			t.id !== token.id &&
			!t.document.hidden
		);

		if (targets.length === 0) return null;

		targets.sort((a, b) =>
			canvas.grid.measureDistance(token.center, a.center) -
			canvas.grid.measureDistance(token.center, b.center)
		);

		return targets[0];
	}

	async moveToTarget(target) {
		if (!target) return;

		const pathfinder = game.modules.get("lib-find-the-path-12")?.api;
		if (!pathfinder) {
			console.warn("mookAI | [DSA5] Pathfinder-Modul fehlt (lib-find-the-path-12)");
			return;
		}

		const path = await pathfinder.findPath(this.token, target, { reach: 1 });
		if (path?.length > 0) {
			await this.token._animateMovement(path);
		}
	}

	async doAttack(name_ = "Default Attack") {
		const actor = this.token.actor;
		if (!actor) return;

		debugLog(`mookAI | [DSA5] Attempting attack: ${name_}`);

		const weapon = actor.items.find(i =>
			["meleeweapon", "rangeweapon", "throwweapon"].includes(i.type)
		);
		if (!weapon) {
			console.warn("mookAI | [DSA5] No suitable weapon found.");
			return;
		}

		const skillName = weapon.system.combatskill?.value;
		const skillItem = actor.items.find(i => i.type === "combatskill" && i.name === skillName);
		const baseAttack = skillItem?.system.at?.value ?? 10;
		const mod = weapon.system.atmod?.value ?? 0;
		const atValue = baseAttack + mod;

		const attackRoll = await new Roll("1d20").roll({ async: true });
		await attackRoll.toMessage({ flavor: `🎯 Angriff mit ${weapon.name} (AT ${atValue})` });

		if (attackRoll.total <= atValue) {
			const tpFormula = weapon.system.damage?.value || "1d6+1";
			const damageRoll = await new Roll(tpFormula).roll({ async: true });
			await damageRoll.toMessage({ flavor: `💥 Trefferpunkte mit ${weapon.name}` });
		} else {
			ui.notifications.info("Der Angriff verfehlt.");
		}

		this.actionsRemaining -= 1;
	}

	async takeTurn() {
		this.actionsRemaining = 1;

		const target = this.chooseTarget();
		if (!target) {
			debugLog("mookAI | [DSA5] No valid target found.");
			return;
		}

		await this.moveToTarget(target);
		await this.doAttack();
	}
}

// Modul-Initialisierung
Hooks.once("init", () => {
	console.log("✅ mookAI-DSA5 | Modul wird initialisiert");

	const module = game.modules.get("mookAI-DSA5");
	if (module) {
		module.api = {
			systemModels: {
				dsa5: {
					model: MookModelDSA5,
					settings: MookModelSettings
				}
			}
		};
	}
});

// Hotkey: Taste "G" steuert den Zug des aktuell ausgewählten Tokens
Hooks.once("ready", () => {
	window.addEventListener("keydown", async (event) => {
		if (event.key.toLowerCase() === "g" && !event.repeat && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
			const token = canvas.tokens.controlled[0];
			if (!token) {
				ui.notifications.warn("Bitte ein Token auswählen.");
				return;
			}

			const model = new MookModelDSA5(token, new MookModelSettings(token));
			await model.takeTurn();
		}
	});
	console.log("🟢 mookAI-DSA5 | Hotkey G aktiviert");
});
