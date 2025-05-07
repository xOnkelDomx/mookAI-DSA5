import { MookModel, ActionType } from "../../mookAI-12/scripts/mookModel.js";
import { MookModelSettings } from "../../mookAI-12/scripts/mookModelSettings.js";
import { debugLog } from "../../mookAI-12/scripts/behaviors.js";

/*
   DSA5-spezifisches MookModel für mookAI. Unterstützt einfache Nah-, Fern- und Wurfwaffenangriffe.
*/
class MookModelDSA5 extends MookModel {
    constructor(token_, settings_, ...args_) {
        super(token_, settings_);
        this.actionsRemaining = 1; // DSA5: in der Regel 1 Aktion pro Runde
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

        targets.sort((a, b) => {
            const distA = canvas.grid.measureDistance(token.center, a.center);
            const distB = canvas.grid.measureDistance(token.center, b.center);
            return distA - distB;
        });

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
        if (!path || path.length === 0) return;

        await this.token._animateMovement(path);
    }

    async doAttack(name_) {
        const actor = this.token.actor;
        if (!actor) {
            console.warn("mookAI | [DSA5] Actor not found.");
            return;
        }

        debugLog(`mookAI | [DSA5] Attempting attack: ${name_}`);

        let weapon = actor.items.find(i => i.type === "meleeweapon") ||
                     actor.items.find(i => i.type === "rangeweapon") ||
                     actor.items.find(i => i.type === "throwweapon");

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

        const success = attackRoll.total <= atValue;
        debugLog(`mookAI | [DSA5] Attack Roll: ${attackRoll.total} vs AT ${atValue} => ${success ? "Treffer" : "Verfehlt"}`);

        if (success) {
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
        await this.doAttack("Default Attack");
    }
}

// Initialisierung
Hooks.once("init", () => {
    console.log("✅ mookAI-DSA5: init hook erreicht");
});

// Bereitstellung der API für andere Module
Hooks.once("ready", () => {
    // Eigene API definieren
    const api = {
        systemModels: {
            dsa5: {
                model: MookModelDSA5,
                settings: MookModelSettings
            }
        },
        // weitere API-Funktionen bei Bedarf
    };

    const mod = game.modules.get("mookAI-12");
    if (mod) {
        mod.api = api;
        console.log("📡 mookAI-12 API registriert:", mod.api);

        // Testweise Nutzung von registerSystemModel falls verfügbar
        if (mod.api?.registerSystemModel) {
            mod.api.registerSystemModel("dsa5", MookModelDSA5, MookModelSettings);
            console.log("✅ mookAI-DSA5: ModelClass via registerSystemModel() registriert");

            setTimeout(() => {
                const testModel = mod.api.getModelForSystem?.("dsa5");
                console.log("🧪 Überprüftes Model für 'dsa5' nach Timeout:", testModel);
            }, 100);
        }
    } else {
        console.error("❌ Modul mookAI-12 nicht gefunden");
    }
});
