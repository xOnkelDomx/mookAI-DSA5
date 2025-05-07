import { Behaviors, MookTypes, Target, debugLog } from "./behaviors.js";
import { ActionType, MookModel } from "./mookModel.js";
import { PathManager } from "../../lib-find-the-path-12/scripts/pathManager.js";
import { PointFactory, SquareNeighborAngles, AngleTypes } from "../../lib-find-the-path-12/scripts/point.js";
import { FTPUtility } from "../../lib-find-the-path-12/scripts/utility.js";

export class Abort extends Error {
	constructor(...params) {
		super(...params);
		if (Error.captureStackTrace) Error.captureStackTrace(this, Abort);
		this.name = "Abort";
	}
};

export class Mook {
	constructor(token_, metric_) {
		this._token = token_;
		if (!this._token) throw new Abort(`Token with id ${token_?.id} not found`);

		this._pointFactory = new PointFactory(metric_);
		this._pathManager = new PathManager(metric_);
		this._mookModel = MookModel.getMookModel(token_);
		this._start = this._pointFactory.segmentFromToken(token_);
		this._segment = this._start;
		this._targetedTokens = [];
		this._visibleTargets = [];
		this._time = this.mookModel.time;
		this._plan = [];

		this._collisionConfig = { checkCollision: true, whitelist: [token_] };
		this._pathManagerConfig = {
			collision: this._collisionConfig,
			priorityMeasure: null,
			constrainVision: !game.settings.get("mookAI-DSA5", "MookOmniscience")
		};

		this.utility = new FTPUtility({
			token: token_,
			collisionConfig: this._collisionConfig
		});

		this.pcWarning = `<p style="color:red">Warning: Token is owned by a player!</p>`;
	}
	async startTurn() {
		this.takeControl();
		this.mookModel.startTurn();
		this._start = this._pointFactory.segmentFromToken(this.token);
		this._segment = this._start;
		this._isExplorer = this.isExplorer;
		this.time = this.mookModel.time;
		this._visibleTargets.splice(0);
		if (this.rotationDisabled) await this.lockRotation();
	}

	async sense() {
		this.pathManager.clearAll();
		this._visibleTargets = game.combat?.combatants?.filter(c => {
			const id = c.tokenId;
			if (id === this.token.id) return false;

			const token = canvas.tokens.get(id);
			if (!token || !this.isPC(token) || !token.inCombat) return false;
			if (this.mookModel.getCurrentHealth(token) <= 0) return false;
			if (this.mookModel.hasVision && !this.canSee(id)) return false;

			return true;
		}).map(c => canvas.tokens.get(c.tokenId)) || [];

		for (const t of this.visibleTargets) {
			await this.pathManager.addToken(this.token, t, this.time, this.pathManagerConfig);
		}
	}
	planTurn() {
		this.plan.splice(0);

		if (this.visibleTargets.length === 0) {
			if (this.time < 1) {
				this.plan.push(this.mookModel.haltAction());
				return;
			}

			if (!this.isExploreDisabled) {
				this.plan.push({ actionType: ActionType.EXPLORE });
				this.plan.push(this.mookModel.senseAction());
				this.plan.push(this.mookModel.planAction());
			} else {
				this.plan.push(this.mookModel.haltAction());
			}
			return;
		}

		const targets = this.viableTargets;
		if (!targets) {
			const closest = Behaviors.getSmallest(this.visibleTargets, t =>
				this.pathManager.path(this.token.id, t.id).cost
			);

			if (closest) {
				this.plan.push(this.mookModel.faceAction(closest));
				this.plan.push(this.mookModel.stepAction());
				this.plan.push(this.mookModel.senseAction());
				this.plan.push(this.mookModel.planAction());
				return;
			}

			if (this.mookModel.canZoom) {
				this.time += this.mookModel.zoom();
				this.plan.push(this.mookModel.senseAction());
				this.plan.push(this.mookModel.planAction());
				return;
			}

			this.plan.push({ actionType: ActionType.EXPLORE });
			this.plan.push(this.mookModel.senseAction());
			this.plan.push(this.mookModel.planAction());
			return;
		}

		const target = Behaviors.chooseTarget(this, targets);
		this.plan.push({
			actionType: ActionType.TARGET,
			data: { target: target.token }
		});

		const path = this.pathManager.path(this.token.id, target.id);
		if (path.valid) {
			const subpath = path.path.filter(n => n.distToDest >= target.range);
			const cost = subpath.length
				? subpath[subpath.length - 1].distTraveled
				: path.within(target.range).length - 1;

			this.plan.push({
				actionType: ActionType.TRAVERSE,
				cost,
				data: { path, dist: target.range }
			});
		} else {
			this.plan.push({
				actionType: ActionType.TRAVERSE,
				cost: 0,
				data: { path: null, dist: target.range }
			});
		}

		this.plan.push(this.mookModel.faceAction(target.token));
		this.plan.push(target.attackAction);
		this.plan.push(this.mookModel.haltAction());
	}
	async act() {
		try {
			let tries = 100;
			while (this.time >= 0 && --tries) {
				if (this.plan.length === 0) {
					console.warn("mookAI | Planning failure: empty plan.");
					return;
				}

				if (this.plan.reduce((a, b) => a + (b?.cost || 0), 0) > this.time) {
					if (this.mookModel.canZoom) {
						this.time += this.mookModel.zoom();
						continue;
					}
					console.warn("mookAI | Planning failure: too ambitious.");
					return;
				}

				const action = this.plan.shift();
				debugLog("Executing action:", action);

				switch (action.actionType) {
					case ActionType.HALT:
						this.cleanup();
						return;

					case ActionType.SENSE:
						await this.sense();
						break;

					case ActionType.PLAN:
						this.planTurn();
						break;

					case ActionType.ROTATE:
						await this.rotate(action.data);
						break;

					case ActionType.FACE:
						await this.rotate(this.degreesToTarget(action.data));
						break;

					case ActionType.MOVE:
						if (await this.move(action.data)) {
							this.mookModel.recordMovement(1);
						}
						break;

					case ActionType.STEP:
						if (await this.step()) {
							this.mookModel.recordMovement(1);
						} else {
							this.handleFailure(new Error("Failed to step."));
						}
						break;

					case ActionType.EXPLORE:
						if (this.isExploreDisabled) {
							this.handleFailure(new Abort("Exploration disabled."));
						}

						if (!this._isExplorer) {
							const dialogContent = `${this.token.actor.hasPlayerOwner ? this.pcWarning : ""}
								<p>Mook couldn't find a target. Explore the environment?</p>`;

							const confirmed = await new Promise((resolve, reject) => {
								new Dialog({
									title: "mookAI-DSA5: Explore?",
									content: dialogContent,
									buttons: {
										yes: { label: "Explore", callback: () => resolve(true) },
										no: { label: "Cancel", callback: () => reject(false) }
									},
									default: "yes",
									close: () => reject(false)
								}).render(true);
							}).catch(() => false);

							if (!confirmed) {
								this.handleFailure(new Abort("Exploration cancelled."));
								return;
							}

							this._isExplorer = true;
						}

						const exploreActions = this.mookModel.exploreActions();
						this.plan.unshift(...exploreActions);
						break;

					case ActionType.TARGET:
						this.target(action.data.target);
						break;

					case ActionType.ATTACK:
						while (this.mookModel.canAttack) {
							await this.mookModel.attack(action);
						}
						break;

					case ActionType.TRAVERSE:
						if (action.cost > 0) {
							this.utility.path = action.data.path;
							this.utility.highlightPoints(action.data.path.path.map(n => n.origin));
						}

						if (!game.settings.get("mookAI-DSA5", "SkipActionConfirmation")) {
							const content = `${this.token.actor.hasPlayerOwner ? this.pcWarning : ""}
								<p>Take action?</p>`;

							const approved = await new Promise((resolve, reject) => {
								new Dialog({
									title: "mookAI-DSA5: Confirm Action",
									content,
									buttons: {
										approve: { label: "Yes", callback: resolve },
										reject: { label: "No", callback: reject }
									},
									default: "approve",
									close: reject
								}).render(true);
							}).catch(() => false);

							if (!approved) {
								this.handleFailure(new Abort("Action rejected."));
								return;
							}
						}

						if (action.cost > 0) {
							this.utility.clearHighlights();
							if (await this.utility.traverse(action.data.dist, this.rotationDelay, this.moveDelay)) {
								this.mookModel.recordMovement(action.cost);
							} else {
								this.handleFailure(new Error("Traverse failed"));
							}
						}
						break;
				}

				this.time -= action.cost || 0;
			}

			if (tries <= 0) {
				this.handleFailure(new Error("Loop limit reached."));
			}
			if (this.time < 0) {
				this.handleFailure(new Error("Negative time after actions."));
			}
		} catch (e) {
			console.error("mookAI | Uncaught error in act():", e);
		}
	}
	inCombat() { return this.token.inCombat; }

	isPC(token_ = this.token) {
		return token_.actor.hasPlayerOwner;
	}

	async cleanup() {
		this.utility.clearHighlights();
		this.clearTargets();
		await this.endTurn();
	}

	handleFailure(error_) {
		throw error_;
	}

	canSee(id_) {
		return canvas.tokens.children[0]?.children?.some(e => e.id === id_ && e.isVisible);
	}

	async centerCamera() {
		const p = this._pointFactory.centerFromToken(this.token);
		await canvas.animatePan({ x: p.px, y: p.py });
	}

	async rotate(dTheta_) {
		if (dTheta_ == null || isNaN(dTheta_)) {
			console.error("mookAI | Invalid rotation.");
			return;
		}
		if (this.rotationDisabled) return;

		await this.tokenDoc.update({ rotation: (this.rotation + dTheta_) % 360 });
		await new Promise(res => setTimeout(res, this.rotationDelay));
	}

	get viableTargets() {
		let meleTargets = [], rangedTargets = [];

		if (this.mookModel.hasMele) {
			meleTargets = this.visibleTargets.filter(t =>
				this.isTargetReachable(t, this.mookModel.meleRange)
			);
		}

		if (this.mookModel.hasRanged) {
			rangedTargets = this.visibleTargets.filter(t =>
				this.isTargetReachable(t, this.mookModel.rangedRange)
			);
		}

		if (!meleTargets.length && !rangedTargets.length) return null;
		return { mele: meleTargets, ranged: rangedTargets };
	}

	degreesToTarget(target_) {
		const p1 = this._pointFactory.centerFromToken(this.token);
		const p2 = this._pointFactory.centerFromToken(target_);
		return p1.radialDistToPoint(p2, this.rotation, AngleTypes.DEG);
	}

	async move(segment_) {
		if (!this.utility.isTraversable(this.segment, segment_)) return false;

		let error = false;
		await this.rotate(this.segment.radialDistToSegment(segment_, this.tokenDoc.rotation, AngleTypes.DEG));
		await this.tokenDoc.update({ x: segment_.point.px, y: segment_.point.py }).catch(err => {
			ui.notifications.warn(err);
			error = true;
		});

		if (error) return false;

		this._segment = segment_;
		await this.centerCamera();
		await new Promise(res => setTimeout(res, this.moveDelay));
		return true;
	}

	async step() {
		const angles = this.neighborAngles.sort((a, b) =>
			Math.min(a, 360 - a) - Math.min(b, 360 - b)
		);

		for (let angle of angles) {
			const success = await this.move(this.segment.neighbor(angle, this.rotation));
			if (success) return true;
		}

		return false;
	}

	async endTurn() {
		if (this.rotationDisabled) await this.unlockRotation();
		this.releaseControl();
	}

	isTargetReachable(target_, range_) {
		const path = this.pathManager.path(this.token.id, target_.id);
		return path.terminalDistanceToDest <= range_;
	}
	get rotationDisabled() {
		return game.settings.get("mookAI-DSA5", "DisableRotation");
	}

	async lockRotation() {
		if (this.tokenLocked === true) return;
		await this.tokenDoc.update({ lockRotation: true });
		this._disabledRotation = true;
	}

	async unlockRotation() {
		if (!this._disabledRotation) return;
		await this.tokenDoc.update({ lockRotation: false });
		this._disabledRotation = false;
	}

	releaseControl() {
		this.token.release({});
	}

	takeControl() {
		this.token.control({});
	}

	clearTargets() {
		for (const t of this._targetedTokens) {
			t.setTarget(false, { releaseOthers: true, groupSelection: false });
		}
		this._targetedTokens = [];
	}

	target(token_) {
		this._targetedTokens.push(token_);
		token_.setTarget(true, { releaseOthers: true, groupSelection: false });
	}

	get isExploreDisabled() {
		const ret = game.settings.get("mookAI-DSA5", "DisableExploration");
		return typeof ret === "boolean" ? ret : false;
	}

	get isExplorer() {
		const ret = game.settings.get("mookAI-DSA5", "ExploreAutomatically");
		return typeof ret === "boolean" ? ret : false;
	}

	get neighborAngles() {
		return Object.values(SquareNeighborAngles);
	}

	get mookModel() {
		return this._mookModel;
	}

	get moveDelay() {
		const val = game.settings.get("mookAI-DSA5", "MoveAnimationDelay");
		return Math.max(0, Math.min(val, 1000));
	}

	get pathManager() {
		return this._pathManager;
	}

	get pathManagerConfig() {
		this._pathManagerConfig.constrainVision = !game.settings.get("mookAI-DSA5", "MookOmniscience");
		return this._pathManagerConfig;
	}

	get plan() {
		return this._plan;
	}

	get point() {
		return this._segment.point;
	}

	get rotation() {
		return this.token.document.rotation;
	}

	get rotationDelay() {
		const val = game.settings.get("mookAI-DSA5", "RotationAnimationDelay");
		return Math.max(0, Math.min(val, 1000));
	}

	get segment() {
		return this._segment;
	}

	get time() {
		return this._time;
	}

	set time(val) {
		this._time = val;
	}

	get token() {
		return this._token;
	}

	get tokenDoc() {
		return game.scenes.active.tokens.get(this._token.id) || this._token.document;
	}

	get tokenLocked() {
		return this.tokenDoc.lockRotation;
	}

	get visibleTargets() {
		return this._visibleTargets;
	}
}
