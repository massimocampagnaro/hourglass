/* ============================================================
   js/cards.js — Phase 2/3: multiple hourglasses side by side.

   Owns the row of hourglass "cards" (up to MAX_CARDS): building
   their DOM, the configuring/locked state machine (setup panel
   vs. compact icon toolbar), per-card color/sound/label, the
   Pomodoro preset, and the automatic mode sequencer that chains
   cards together in a loop until stopped. js/app.js wires this
   manager up to the page's global chrome (mute, keep-sand-on-flip,
   automatic-mode toggle, Pomodoro button, keyboard shortcuts).
   ============================================================ */

(function () {
    'use strict';

    const {
        clampMinutes, formatTime, sizeScaleForMinutes, MAX_CARDS,
        COLOR_PALETTE, resolveColor, POMODORO_FOCUS_COLOR_ID, POMODORO_BREAK_COLOR_ID,
        SOUND_IDS, playSound,
    } = window.HourglassShared;

    const PRESET_MINUTES = [5, 25, 30, 60];

    // Base "scale 1.0" ceiling, in px, before a card's own duration-based
    // --hg-scale is applied — shrinks as more cards share the row so 2-3
    // of them comfortably sit side by side instead of only ever being
    // constrained by the viewport-width clamp.
    const COUNT_BASE_PX = { 1: 300, 2: 230, 3: 180 };

    const PLAY_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><polygon points="7,4 20,12 7,20" fill="currentColor"/></svg>';
    const PAUSE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/></svg>';
    const RESET_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M19 6.5A7.5 7.5 0 1 0 20.5 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polygon points="20.5,4 20.5,9.5 15,9.5" fill="currentColor"/></svg>';
    const EDIT_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><g transform="rotate(45 12 12)"><rect x="10.5" y="2" width="3" height="14" rx="1" fill="currentColor"/><polygon points="10.5,16 13.5,16 12,20" fill="currentColor"/></g></svg>';
    const REMOVE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const ADD_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    let nextCardUid = 0;

    function pickDefaultColorId(existingColorIds) {
        const unused = COLOR_PALETTE.find((c) => !existingColorIds.includes(c.id));
        return unused ? unused.id : COLOR_PALETTE[existingColorIds.length % COLOR_PALETTE.length].id;
    }

    // Same idea as pickDefaultColorId, in SOUND_IDS' own 1/2/3 order: the
    // first sound not already claimed by another card, so a fresh card
    // never starts out silently duplicating a sound that's already in use.
    function pickDefaultSoundId(existingSoundIds) {
        const unused = SOUND_IDS.find((id) => !existingSoundIds.includes(id));
        return unused || SOUND_IDS[existingSoundIds.length % SOUND_IDS.length];
    }

    function createCardManager(rowEl, opts) {
        opts = opts || {};
        let muted = !!opts.muted;
        let resetOnFlip = opts.resetOnFlip !== false;
        let autoMode = false;
        const onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};

        const cards = [];
        let configuringId = null;
        const sequence = { active: false, index: -1 };

        // Real cards live in their own inner group; .hourglass-row (see
        // css/style.css) is a 3-column grid that keeps this group
        // centered regardless of how many cards it holds, with the Add
        // button pinned in its own column to the side.
        const cardsWrapEl = document.createElement('div');
        cardsWrapEl.className = 'hourglass-cards';
        rowEl.appendChild(cardsWrapEl);

        const addBtnEl = buildAddButton();
        rowEl.appendChild(addBtnEl);

        // ─── layout ──────────────────────────────────────────
        function updateRowLayout() {
            const count = cards.length || 1;
            rowEl.style.setProperty('--hg-count', String(count));
            const basePx = COUNT_BASE_PX[count] || COUNT_BASE_PX[3];
            cards.forEach((c) => {
                c.el.style.setProperty('--hg-base-px', basePx + 'px');
                c.el.style.setProperty('--hg-scale', sizeScaleForMinutes(c.minutes).toFixed(3));
            });
        }

        function applyCardColor(card) {
            const c = resolveColor(card.colorId);
            card.el.style.setProperty('--color-sand', c.sand);
            card.el.style.setProperty('--color-sand-light', c.light);
            card.el.style.setProperty('--color-sand-dark', c.dark);
        }

        function updateCardLabelDisplay(card) {
            card.labelEl.textContent = card.label || '';
            card.labelEl.hidden = !card.label;
        }

        // ─── DOM builders ────────────────────────────────────
        function buildAddButton() {
            const el = document.createElement('div');
            el.className = 'hourglass-card hourglass-card--add';
            el.setAttribute('role', 'button');
            el.tabIndex = 0;
            el.setAttribute('aria-label', 'Add hourglass');
            el.innerHTML = `<div class="add-icon">${ADD_SVG}</div><div class="add-label">Add</div>`;
            return el;
        }

        function buildToolbar(card) {
            const toolbar = document.createElement('div');
            toolbar.className = 'card-toolbar';

            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'icon-btn';
            toggleBtn.dataset.action = 'toggle';
            toggleBtn.innerHTML = PLAY_SVG;
            toggleBtn.setAttribute('aria-label', 'Start');
            toolbar.appendChild(toggleBtn);
            card.toggleBtn = toggleBtn;

            const resetBtn = document.createElement('button');
            resetBtn.type = 'button';
            resetBtn.className = 'icon-btn';
            resetBtn.dataset.action = 'reset';
            resetBtn.innerHTML = RESET_SVG;
            resetBtn.setAttribute('aria-label', 'Reset');
            toolbar.appendChild(resetBtn);

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'icon-btn';
            editBtn.dataset.action = 'edit';
            editBtn.innerHTML = EDIT_SVG;
            editBtn.setAttribute('aria-label', 'Edit');
            toolbar.appendChild(editBtn);
            card.editBtn = editBtn;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'icon-btn icon-btn--danger';
            removeBtn.dataset.action = 'remove';
            removeBtn.innerHTML = REMOVE_SVG;
            removeBtn.setAttribute('aria-label', 'Remove');
            toolbar.appendChild(removeBtn);
            card.removeBtn = removeBtn;

            return toolbar;
        }

        function buildConfigPanel(card) {
            const panel = document.createElement('div');
            panel.className = 'card-config-panel';

            const durationRow = document.createElement('div');
            durationRow.className = 'duration-control';
            const durationLabel = document.createElement('label');
            durationLabel.textContent = 'Minutes';
            const durationInput = document.createElement('input');
            durationInput.type = 'number';
            durationInput.min = '1';
            durationInput.max = '180';
            durationInput.step = '1';
            durationInput.inputMode = 'numeric';
            durationInput.className = 'duration-input';
            durationRow.appendChild(durationLabel);
            durationRow.appendChild(durationInput);
            panel.appendChild(durationRow);
            card.durationInputEl = durationInput;

            const presetRow = document.createElement('div');
            presetRow.className = 'preset-row';
            PRESET_MINUTES.forEach((m) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'preset-btn';
                btn.dataset.action = 'preset';
                btn.dataset.minutes = String(m);
                btn.textContent = String(m);
                presetRow.appendChild(btn);
            });
            panel.appendChild(presetRow);
            card.presetRowEl = presetRow;

            const labelRow = document.createElement('div');
            labelRow.className = 'label-control';
            const labelLabel = document.createElement('label');
            labelLabel.textContent = 'Label';
            const labelInput = document.createElement('input');
            labelInput.type = 'text';
            labelInput.maxLength = 16;
            labelInput.placeholder = 'Optional';
            labelInput.className = 'card-label-input';
            labelRow.appendChild(labelLabel);
            labelRow.appendChild(labelInput);
            panel.appendChild(labelRow);
            card.labelInputEl = labelInput;

            const swatchRow = document.createElement('div');
            swatchRow.className = 'swatch-row';
            COLOR_PALETTE.forEach((c) => {
                const resolved = resolveColor(c.id);
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'swatch-btn';
                btn.dataset.action = 'swatch';
                btn.dataset.colorId = c.id;
                btn.style.setProperty('--swatch-color', resolved.sand);
                btn.title = c.name;
                btn.setAttribute('aria-label', c.name);
                swatchRow.appendChild(btn);
            });
            panel.appendChild(swatchRow);
            card.swatchRowEl = swatchRow;

            const soundRow = document.createElement('div');
            soundRow.className = 'sound-row';
            SOUND_IDS.forEach((soundId, i) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'sound-btn';
                btn.dataset.action = 'sound';
                btn.dataset.soundId = soundId;
                btn.textContent = String(i + 1);
                btn.title = 'Sound ' + (i + 1) + ' (click to preview)';
                soundRow.appendChild(btn);
            });
            panel.appendChild(soundRow);
            card.soundRowEl = soundRow;

            const actionsRow = document.createElement('div');
            actionsRow.className = 'config-actions';
            const saveBtn = document.createElement('button');
            saveBtn.type = 'button';
            saveBtn.className = 'btn btn-primary';
            saveBtn.dataset.action = 'save';
            saveBtn.textContent = 'Done';
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'btn';
            cancelBtn.dataset.action = 'cancel';
            cancelBtn.textContent = 'Cancel';
            actionsRow.appendChild(saveBtn);
            actionsRow.appendChild(cancelBtn);
            panel.appendChild(actionsRow);
            card.saveBtnEl = saveBtn;

            return panel;
        }

        function buildCardDom(card) {
            const el = document.createElement('div');
            el.className = 'hourglass-card';
            el.dataset.cardId = card.id;

            const labelEl = document.createElement('div');
            labelEl.className = 'card-label';
            el.appendChild(labelEl);
            card.labelEl = labelEl;

            const shellEl = document.createElement('div');
            shellEl.className = 'hourglass-shell';
            shellEl.tabIndex = 0;
            shellEl.setAttribute('role', 'button');
            shellEl.setAttribute('aria-label', 'Flip hourglass');
            const wrapEl = document.createElement('div');
            wrapEl.className = 'hourglass-canvas-wrap';
            const canvas = document.createElement('canvas');
            canvas.className = 'grain-canvas';
            wrapEl.appendChild(canvas);
            shellEl.appendChild(wrapEl);
            el.appendChild(shellEl);
            card.shellEl = shellEl;
            card.wrapEl = wrapEl;

            const timeEl = document.createElement('div');
            timeEl.className = 'time-readout';
            timeEl.textContent = '00:00';
            el.appendChild(timeEl);
            card.timeEl = timeEl;

            const toolbarEl = buildToolbar(card);
            el.appendChild(toolbarEl);
            card.toolbarEl = toolbarEl;

            const configEl = buildConfigPanel(card);
            configEl.hidden = true;
            el.appendChild(configEl);
            card.configEl = configEl;

            cardsWrapEl.appendChild(el);
            card.el = el;

            card.glass = new Hourglass(wrapEl);
            card.glass.resetOnFlip = resetOnFlip;
            wireGlassCallbacks(card); // must be wired before setDuration() so its initial _notifyTick() isn't dropped
            card.glass.setDuration(card.minutes);
            applyCardColor(card);
            updateCardLabelDisplay(card);
        }

        function wireGlassCallbacks(card) {
            card.glass.onTick = (remainingMs) => {
                card.timeEl.textContent = formatTime(remainingMs);
            };
            card.glass.onDone = () => {
                card.timeEl.classList.add('is-done');
                if (!muted) playSound(card.soundId);
                refreshUI();
                const idx = indexOfCard(card);
                if (autoMode && sequence.active && sequence.index === idx) {
                    setTimeout(() => advanceSequence(idx), 900);
                }
            };
        }

        function findCard(id) {
            return cards.find((c) => c.id === id) || null;
        }

        function indexOfCard(card) {
            return cards.indexOf(card);
        }

        // ─── configuring state ───────────────────────────────
        function fillConfigPanelFromCard(card) {
            card.durationInputEl.value = card.minutes;
            card.labelInputEl.value = card.label;
            card.saveBtnEl.textContent = card.isNew ? 'Create' : 'Save';
            syncPresetButtons(card);
            syncSwatchButtons(card);
            syncSoundButtons(card);
        }

        function syncPresetButtons(card) {
            card.presetRowEl.querySelectorAll('.preset-btn').forEach((btn) => {
                btn.classList.toggle('is-active', Number(btn.dataset.minutes) === card.minutes);
            });
        }

        function syncSwatchButtons(card) {
            card.swatchRowEl.querySelectorAll('.swatch-btn').forEach((btn) => {
                btn.classList.toggle('is-active', btn.dataset.colorId === card.colorId);
            });
        }

        function syncSoundButtons(card) {
            card.soundRowEl.querySelectorAll('.sound-btn').forEach((btn) => {
                btn.classList.toggle('is-active', btn.dataset.soundId === card.soundId);
            });
        }

        function enterConfiguring(card) {
            configuringId = card.id;
            card.flipPending = false;
            card.glass.pause();
            card.glass.reset();
            card.timeEl.classList.remove('is-done');
            card.el.classList.add('is-configuring');
            card.toolbarEl.hidden = true;
            card.configEl.hidden = false;
            fillConfigPanelFromCard(card);
            refreshUI();
        }

        function exitConfiguring(card) {
            configuringId = null;
            card.el.classList.remove('is-configuring');
            card.toolbarEl.hidden = false;
            card.configEl.hidden = true;
            refreshUI();
        }

        function setCardMinutesLive(card, minutesRaw) {
            card.minutes = clampMinutes(minutesRaw);
            card.glass.setDuration(card.minutes);
            syncPresetButtons(card);
            updateRowLayout();
        }

        // ─── actions ──────────────────────────────────────────
        function handleAddCard() {
            if (cards.length >= MAX_CARDS || configuringId != null || sequence.active) return;
            const card = {
                id: 'c' + (nextCardUid++),
                minutes: 5,
                colorId: pickDefaultColorId(cards.map((c) => c.colorId)),
                soundId: pickDefaultSoundId(cards.map((c) => c.soundId)),
                label: '',
                isNew: true,
            };
            cards.push(card);
            buildCardDom(card);
            updateRowLayout();
            enterConfiguring(card);
        }

        function handleEdit(card) {
            if (configuringId != null || sequence.active) return;
            card._snapshot = { minutes: card.minutes, colorId: card.colorId, soundId: card.soundId, label: card.label };
            enterConfiguring(card);
        }

        function handleSave(card) {
            card.isNew = false;
            exitConfiguring(card);
        }

        function removeCardInternal(card) {
            const idx = indexOfCard(card);
            if (idx === -1) return;
            if (sequence.index === idx) stopSequence();
            card.glass.pause();
            card.el.remove();
            cards.splice(idx, 1);
            // Automatic mode only means anything with 2+ cards to chain —
            // dropping to one turns it back off rather than leaving it
            // silently armed with its toggle now hidden (see refreshUI).
            if (cards.length <= 1) autoMode = false;
            updateRowLayout();
            refreshUI();
        }

        function handleCancel(card) {
            configuringId = null;
            if (card.isNew) {
                removeCardInternal(card);
                return;
            }
            Object.assign(card, card._snapshot);
            card.glass.setDuration(card.minutes);
            applyCardColor(card);
            updateCardLabelDisplay(card);
            updateRowLayout();
            exitConfiguring(card);
        }

        function handleRemove(card) {
            if (cards.length <= 1 || sequence.active) return;
            if (configuringId === card.id) configuringId = null;
            removeCardInternal(card);
        }

        function handleSwatch(card, colorId) {
            card.colorId = colorId;
            applyCardColor(card);
            syncSwatchButtons(card);
        }

        function handleSoundPick(card, soundId) {
            card.soundId = soundId;
            syncSoundButtons(card);
            if (!muted) playSound(soundId);
        }

        function handleDurationCommit(card, rawValue) {
            const val = parseInt(rawValue, 10);
            setCardMinutesLive(card, Number.isFinite(val) ? val : card.minutes);
            card.durationInputEl.value = card.minutes;
        }

        function handleLabelInput(card, value) {
            card.label = value.slice(0, 16);
            updateCardLabelDisplay(card);
        }

        // ─── manual + automatic playback ────────────────────
        function handleToggle(card) {
            if (!autoMode) {
                if (card.flipPending) return; // a flip is already committing to "running" a few hundred ms from now; let it settle
                if (card.glass.running) {
                    card.glass.pause();
                } else {
                    card.timeEl.classList.remove('is-done');
                    card.glass.start();
                }
                refreshUI();
                return;
            }
            const idx = indexOfCard(card);
            if (sequence.active && sequence.index === idx) {
                pauseSequence();
            } else if (!sequence.active && sequence.index === idx) {
                resumeSequence();
            } else {
                startSequenceAt(idx);
            }
        }

        function handleReset(card) {
            if (autoMode) {
                stopSequence();
                cards.forEach((c) => {
                    c.flipPending = false;
                    c.glass.reset();
                    c.timeEl.classList.remove('is-done');
                });
            } else {
                card.flipPending = false;
                card.glass.reset();
                card.timeEl.classList.remove('is-done');
            }
            refreshUI();
        }

        function handleShellClick(card) {
            if (autoMode || configuringId != null) return;
            card.timeEl.classList.remove('is-done');
            // flip() pauses immediately, then only actually resumes (running
            // becomes true) once its spin/pour animation finishes a few
            // hundred ms later — reading card.glass.running right now would
            // catch that brief paused instant. A flip always ends up
            // running though, so the toggle icon can commit to that outcome
            // immediately; flipPending is cleared (and the icon reconciled,
            // in case something else interrupted it) once the flip settles.
            card.flipPending = true;
            card.glass.flip();
            refreshUI();
            setTimeout(() => {
                card.flipPending = false;
                refreshUI();
            }, 550);
        }

        function startSequenceAt(idx) {
            cards.forEach((c) => {
                c.flipPending = false;
                c.glass.pause();
                c.glass.reset();
                c.timeEl.classList.remove('is-done');
                c.el.classList.remove('is-sequence-active');
            });
            sequence.active = true;
            sequence.index = idx;
            const card = cards[idx];
            card.el.classList.add('is-sequence-active');
            card.glass.start();
            refreshUI();
        }

        function pauseSequence() {
            const card = cards[sequence.index];
            if (card) {
                card.glass.pause();
                card.el.classList.remove('is-sequence-active');
            }
            sequence.active = false;
            refreshUI();
        }

        function resumeSequence() {
            const card = cards[sequence.index];
            if (!card) {
                sequence.index = -1;
                return;
            }
            sequence.active = true;
            card.el.classList.add('is-sequence-active');
            card.glass.start();
            refreshUI();
        }

        function advanceSequence(fromIdx) {
            if (!sequence.active || sequence.index !== fromIdx || !cards.length) return;
            cards[fromIdx].el.classList.remove('is-sequence-active');
            const nextIdx = (fromIdx + 1) % cards.length;
            sequence.index = nextIdx;
            const nextCard = cards[nextIdx];
            nextCard.timeEl.classList.remove('is-done');
            nextCard.glass.reset();
            nextCard.el.classList.add('is-sequence-active');
            nextCard.glass.start();
            refreshUI();
        }

        function stopSequence() {
            if (sequence.index >= 0 && cards[sequence.index]) {
                cards[sequence.index].glass.pause();
                cards[sequence.index].el.classList.remove('is-sequence-active');
            }
            sequence.active = false;
            sequence.index = -1;
            refreshUI();
        }

        // ─── UI refresh ──────────────────────────────────────
        function refreshUI() {
            const configActive = configuringId != null;
            cards.forEach((card, idx) => {
                if (card.id === configuringId) return;
                const isSequenceCard = autoMode && sequence.active && sequence.index === idx;
                const playing = autoMode ? isSequenceCard : (card.glass.running || card.flipPending);
                card.toggleBtn.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
                card.toggleBtn.setAttribute('aria-label', playing ? 'Pause' : 'Start');
                const lockControls = configActive || sequence.active;
                card.editBtn.disabled = lockControls;
                card.removeBtn.disabled = lockControls || cards.length <= 1;
                card.shellEl.classList.toggle('is-flip-disabled', autoMode || configActive);
            });
            // At the 3-card cap, Add isn't just disabled — there's nothing
            // left it could ever do, so it disappears entirely rather than
            // sitting there permanently greyed out. Below the cap it stays
            // visible but disabled while configuring/a sequence is running.
            const atMax = cards.length >= MAX_CARDS;
            addBtnEl.hidden = atMax;
            addBtnEl.classList.toggle('is-disabled', configActive || sequence.active);
            addBtnEl.setAttribute('aria-disabled', String(configActive || sequence.active));
            rowEl.classList.toggle('is-at-max', atMax);
            rowEl.classList.toggle('is-sequence-running', sequence.active);
            onChange(); // refreshUI runs after every discrete state change, so this is the one place that needs to notify the host page (URL sync, popout visibility, etc.)
        }

        // ─── event delegation ────────────────────────────────
        rowEl.addEventListener('click', (e) => {
            const addBtn = e.target.closest('.hourglass-card--add');
            if (addBtn) {
                if (!addBtn.classList.contains('is-disabled')) handleAddCard();
                return;
            }

            const cardEl = e.target.closest('.hourglass-card');
            if (!cardEl) return;
            const card = findCard(cardEl.dataset.cardId);
            if (!card) return;

            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
                if (actionBtn.disabled) return;
                const action = actionBtn.dataset.action;
                if (action === 'toggle') handleToggle(card);
                else if (action === 'reset') handleReset(card);
                else if (action === 'edit') handleEdit(card);
                else if (action === 'remove') handleRemove(card);
                else if (action === 'save') handleSave(card);
                else if (action === 'cancel') handleCancel(card);
                else if (action === 'swatch') handleSwatch(card, actionBtn.dataset.colorId);
                else if (action === 'sound') handleSoundPick(card, actionBtn.dataset.soundId);
                else if (action === 'preset') {
                    setCardMinutesLive(card, Number(actionBtn.dataset.minutes));
                    card.durationInputEl.value = card.minutes;
                }
                return;
            }

            if (e.target.closest('.hourglass-shell') === card.shellEl) handleShellClick(card);
        });

        rowEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
            const addBtn = e.target.closest('.hourglass-card--add');
            if (!addBtn || addBtn.classList.contains('is-disabled')) return;
            e.preventDefault();
            handleAddCard();
        });

        rowEl.addEventListener('change', (e) => {
            if (!e.target.classList.contains('duration-input')) return;
            const cardEl = e.target.closest('.hourglass-card');
            const card = cardEl && findCard(cardEl.dataset.cardId);
            if (card) handleDurationCommit(card, e.target.value);
        });

        rowEl.addEventListener('input', (e) => {
            if (!e.target.classList.contains('card-label-input')) return;
            const cardEl = e.target.closest('.hourglass-card');
            const card = cardEl && findCard(cardEl.dataset.cardId);
            if (card) handleLabelInput(card, e.target.value);
        });

        // ─── public API ──────────────────────────────────────
        function getFocusedCard() {
            const active = document.activeElement;
            const cardEl = active && active.closest && active.closest('.hourglass-card');
            if (cardEl) {
                const card = findCard(cardEl.dataset.cardId);
                if (card) return card;
            }
            return cards[0] || null;
        }

        // Bootstraps the row from parsed URL config (see
        // HourglassShared.readCardsFromParams) — one entry for the legacy
        // single-card link format, up to MAX_CARDS for the indexed
        // h1_/h2_/h3_ one. A null colorId/soundId in a config auto-picks
        // the same "first not already in use" default the Add button
        // does, so a link that only specifies minutes for two cards still
        // gets them visually distinct instead of both defaulting to amber.
        function addCardsFromConfigs(configs) {
            configs.slice(0, MAX_CARDS).forEach((cfg) => {
                const card = {
                    id: 'c' + (nextCardUid++),
                    minutes: clampMinutes(cfg.minutes),
                    colorId: cfg.colorId || pickDefaultColorId(cards.map((c) => c.colorId)),
                    soundId: cfg.soundId || pickDefaultSoundId(cards.map((c) => c.soundId)),
                    label: cfg.label || '',
                    isNew: false,
                };
                cards.push(card);
                buildCardDom(card);
                if (cfg.running) card.glass.start();
            });
            updateRowLayout();
            refreshUI();
        }

        // Current row state, in display order — used to mirror it back
        // into the URL (see js/app.js syncUrl) so a copied link restores
        // the same setup.
        function getCardsSnapshot() {
            return cards.map((c) => ({
                minutes: c.minutes,
                colorId: c.colorId,
                soundId: c.soundId,
                label: c.label,
                running: c.glass.running,
            }));
        }

        function applyPomodoroPreset() {
            stopSequence();
            configuringId = null;
            cards.slice().forEach((c) => {
                c.glass.pause();
                c.el.remove();
            });
            cards.length = 0;

            const focus = {
                id: 'c' + (nextCardUid++), minutes: 25,
                colorId: POMODORO_FOCUS_COLOR_ID, soundId: 'done2', label: 'Focus', isNew: false,
            };
            const brk = {
                id: 'c' + (nextCardUid++), minutes: 5,
                colorId: POMODORO_BREAK_COLOR_ID, soundId: 'done3', label: 'Break', isNew: false,
            };
            [focus, brk].forEach((card) => {
                cards.push(card);
                buildCardDom(card);
            });
            updateRowLayout();
            autoMode = true;
            refreshUI();
        }

        return {
            setMuted(v) { muted = !!v; },
            setResetOnFlip(v) {
                resetOnFlip = !!v;
                cards.forEach((c) => { c.glass.resetOnFlip = resetOnFlip; });
            },
            setAutoMode(v) {
                v = !!v && cards.length > 1; // needs at least 2 cards to mean anything
                if (v === autoMode) return;
                autoMode = v;
                if (!autoMode) stopSequence(); // stopSequence() already runs refreshUI()
                else refreshUI();
            },
            isAutoMode() { return autoMode; },
            isSequenceActive() { return sequence.active; },
            getCardCount() { return cards.length; },
            addCardsFromConfigs,
            getCardsSnapshot,
            applyPomodoroPreset,
            getFocusedCard,
            handleKeyToggle() { const c = getFocusedCard(); if (c) handleToggle(c); },
            handleKeyReset() { const c = getFocusedCard(); if (c) handleReset(c); },
            handleKeyFlip() { const c = getFocusedCard(); if (c) handleShellClick(c); },
        };
    }

    window.HourglassCards = { createCardManager, MAX_CARDS, PRESET_MINUTES };
})();
