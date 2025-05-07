# mookAI-dsa5

This module extends the  [mookAI](https://github.com/CircusGM/mookAI-12) module to support **Das Schwarze Auge 5 (DSA5)** in Foundry VTT.

It provides basic automation for NPCs during combat, allowing them to:
- Automatically detect player characters (Disposition: Friendly)
- Move toward the nearest target using collision-aware pathfinding
- Execute a melee, ranged, or thrown weapon attack based on available equipment
- End their turn after acting

> 🛠 This module is intended for low-intelligence, low-tactics enemies (e.g., orcs, wild animals, bandits) to reduce GM load during large combat scenes.

## Features
- Full support for DSA5 weapons (`meleeweapon`, `rangeweapon`, `throwweapon`)
- Resolves attacks using correct attack values from combat skills
- Rolls damage from item stats
- Moves tokens using `lib-find-the-path-12`

## Requirements
- [mookAI-12](https://github.com/CircusGM/mookAI-12)
- [lib-find-the-path-12](https://foundryvtt.com/packages/lib-find-the-path-12)
- [DSA5 System](https://github.com/Plushtoast/dsa5-foundryVTT)

## Installation
Download and install via Foundry’s module manager using the manifest URL:
