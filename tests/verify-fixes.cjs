// Verification test asserting that the 5 core logical & safety review findings are FIXED in index.js
const assert = require('node:assert/strict');
const {harness} = require('./harness.cjs');
const raw = '<event_archive>ARCHIVE_A</event_archive><segment_1 title="one">SLIP_A1</segment_1><segment_2 title="two">SLIP_A2</segment_2><event_endings>END_A</event_endings>';

(async () => {
    // 1. Fix R1: Cross-account credentials isolation
    const h = harness();
    h.ctx.extensionSettings['st-direct-event'] = { configVersion: 7, baseUrl: 'https://account-b.invalid', apiKey: 'FAKE_KEY_B' };
    h.local.set('st_direct_event_settings_v1', JSON.stringify({ configVersion: 7, baseUrl: 'https://account-a.invalid', apiKey: 'FAKE_KEY_A' }));
    const merged = h.api.getSettings();
    assert.equal(merged.apiKey, 'FAKE_KEY_B', 'Local storage must not overwrite backend server credentials');
    assert.equal(merged.baseUrl, 'https://account-b.invalid', 'Local storage must not overwrite backend server baseUrl');
    console.log('PASS: R1 Cross-account settings isolation verified');

    // 2. Fix R2: World book composite keys preventing collision
    const w = harness({ ctx: { worldInfo: [{ world: 'Book A', uid: 0, constant: true, content: 'A CONTENT' }, { world: 'Book B', uid: 0, constant: true, content: 'B CONTENT' }] } });
    const defaults = { ...w.api.DEFAULT_SETTINGS };
    const initial = await w.api.refreshWorldInfoCache(defaults);
    assert.equal(initial.length, 2);
    // Disabling uid 0 in Book A only via composite key
    const disabled = await w.api.refreshWorldInfoCache({ ...defaults, worldInfoSelections: { 'Book A::0': false } });
    assert.equal(disabled.length, 1, 'Disabling Book A UID 0 should not disable Book B UID 0');
    assert.equal(disabled[0].content, 'B CONTENT');
    // Overriding Book A UID 0 content only
    const edited = await w.api.refreshWorldInfoCache({ ...defaults, worldInfoOverrides: { 'Book A::0': { content: 'EDIT OF A' } } });
    assert.deepEqual(Array.from(edited, e => e.content), ['EDIT OF A', 'B CONTENT'], 'Overriding Book A UID 0 must not pollute Book B');
    console.log('PASS: R2 World book UID isolation verified');

    // 3. Fix R3: Chat switch during save blocks auto-send
    let clicked = false;
    let saves = 0;
    const g = harness({ fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] }) }) });
    const stateA = g.api.getChatState();
    g.ctx.chatId = 'chat-A';
    g.ctx.chat = [{ is_user: true, mes: 'PRIVATE A CONTEXT' }];
    g.ctx.saveChat = async () => {
        saves++;
        g.ctx.chatId = 'chat-B';
        g.ctx.chatMetadata = {};
        g.ctx.chat = [{ is_user: true, mes: 'CHAT B CONTEXT' }];
    };
    const textarea = { value: '', dispatchEvent() {} };
    g.sandbox.document.querySelector = s => s === '#send_textarea' ? textarea : null;
    g.sandbox.document.getElementById = s => s === 'send_but' ? { click() { clicked = true; } } : null;
    await g.api.generateAndSave(g.api.EVENT_TYPES.reasoning, { ...g.api.DEFAULT_SETTINGS, baseUrl: 'https://example.invalid/v1', apiKey: 'FAKE', autoSend: true, enableWorldInfo: false, enableJailbreak: false, enableNovelBypass: false });
    const stateB = g.api.getChatState();
    assert.equal(stateA.events.length, 1, 'Event should be saved in chat A');
    assert.equal(stateB.events.length, 0, 'No event should be saved in chat B');
    assert.equal(stateB.activeEvent, undefined, 'Active event in chat B must not be poisoned');
    assert.equal(clicked, false, 'Trigger must not be sent in chat B after chat switch');
    console.log('PASS: R3 Cross-chat auto-send prevention verified');

    // 4. Fix R4: Swipe retains round 2 progression
    function seed(h) {
        const event = { id: '推理事件c0001', title: '推理事件', type: 'reasoning', content: raw, maxTurns: 2, ...h.api.EventInjectionTool.parse(raw, 2) };
        h.api.getChatState().events.push(event);
        return event;
    }
    async function inject(h, type = 'normal') {
        await h.emit('GENERATION_STARTED', type, {}, false);
        const req = { chat: [{ role: 'user', content: h.ctx.chat.filter(m => m.is_user).at(-1).mes }] };
        await h.emit('CHAT_COMPLETION_PROMPT_READY', req);
        return req;
    }
    const r = harness();
    seed(r);
    r.ctx.chat.push({ is_user: true, mes: 'c0001' });
    await inject(r);
    r.ctx.chat.push({ is_user: false, mes: 'FIRST ANSWER' });
    await r.emit('MESSAGE_RECEIVED', 1, 'normal');
    const token = r.api.getChatState().activeEvent.activationToken;
    assert.equal(r.api.getChatState().activeEvent.currentTurn, 2);

    await inject(r, 'swipe');
    r.ctx.chat[1].mes = 'REPLACEMENT ANSWER';
    await r.emit('MESSAGE_RECEIVED', 1, 'swipe');

    r.ctx.chat.push({ is_user: true, mes: 'Next action' });
    const next = await inject(r);
    assert.equal(r.api.getChatState().activeEvent.currentTurn, 2, 'Next round should be turn 2');
    assert.equal(r.api.getChatState().activeEvent.activationToken, token, 'Token should be preserved');
    assert(!JSON.stringify(next).includes('SLIP_A1'), 'Must not reinject round 1 slip');
    assert(JSON.stringify(next).includes('SLIP_A2'), 'Must inject round 2 slip');
    console.log('PASS: R4 Swipe does not reset first round');

    // 5. Fix R5: Deleted message does not advance old unrelated assistant message
    const d = harness();
    seed(d);
    d.ctx.chat.push({ is_user: false, mes: 'OLD UNRELATED ANSWER' }, { is_user: true, mes: 'c0001' });
    await inject(d);
    d.ctx.chat.push({ is_user: false, mes: 'NEW ANSWER' });
    const pending = d.emit('MESSAGE_RECEIVED', 2, 'normal');
    d.ctx.chat.pop();
    await d.emit('MESSAGE_DELETED', 2);
    await pending;
    assert.equal(d.api.getChatState().activeEvent.currentTurn, 1, 'Turn should remain 1 because reply was deleted');
    assert.equal(d.ctx.chat[0].extra?.st_direct, undefined, 'Old message must not be falsely marked');
    console.log('PASS: R5 Deleted message correctly handled');

    console.log('ALL 5 FIXES VERIFIED SUCCESSFULLY!');
})().catch(e => {
    console.error('VERIFICATION FAILED:', e);
    process.exitCode = 1;
});
