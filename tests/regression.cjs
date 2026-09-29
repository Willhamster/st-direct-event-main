const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {harness}=require('./harness.cjs');
const raw='<event_archive>SECRET_CULPRIT_812：管理员移动了卡片。</event_archive>\n<segment_1 title="起因">ROUND_ONE_123：卡片不见了，桌面有水痕，管理员拿着空盒子询问你要先查看哪处。</segment_1>\n<segment_2 title="收束">ROUND_TWO_456：依据玩家检查空盒子的行动展示结果。</segment_2>\n<event_endings>Good End：GOOD_SECRET_998，卡片找回。\nBad End：BAD_SECRET_997，暂时无法找到。</event_endings>';
function seed(h,n=2) {const content=n===2?raw:raw.replace(/<segment_2[\s\S]*?<\/segment_2>/,''); const parsed=h.api.EventInjectionTool.parse(content,n);const event={id:'推理事件c0001',title:'推理事件',type:'reasoning',content,maxTurns:n,...parsed};h.api.getChatState().events.push(event);return event;}
function request(h,user,tail=false,multi=false) {
    const content=`<interactive_input>\n${user}\n</interactive_input>`;
    return {chat:[{role:'system',content:'既有预设'},{role:'system',content:h.ctx.injection||''},{role:'user',content:multi?[{type:'image_url',image_url:{url:'data:image/png;base64,AA=='}},{type:'text',text:content}]:content},...(tail?[{role:'user',content:'这是预设结尾指示，不是玩家输入'}]:[])]};
}
const text=r=>r.chat.map(x=>typeof x.content==='string'?x.content:JSON.stringify(x.content)).join('\n');
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
(async()=>{
    const h=harness();const event=seed(h);
    check('Array text completion is accepted without reasoning leakage',()=>{const r=h.api.readCompletionBody({choices:[{message:{content:[{type:'text',text:'正文'},{type:'reasoning',text:'秘密推理'}]}}]});assert.equal(r.content,'正文');});
    check('Reasoning-only response is not treated as event content',()=>{const r=h.api.readCompletionBody({choices:[{message:{content:null,reasoning_content:'秘密推理'},finish_reason:'stop'}]});assert.equal(r.content,'');assert(r.error.includes('推理字段'));});
    check('Blocked and truncated completions never retry or deliver partial scripts',()=>{for(const reason of ['content_filter','length']) {const r=h.api.readCompletionBody({choices:[{message:{content:'半截'},finish_reason:reason}]});assert.equal(r.content,'');assert.equal(r.retryable,false);}});
    check('Saved pacing budget can change without corrupting script count',()=>{const t=harness();const e=seed(t);e.maxTurns=3;const active=t.api.activateEvent(e);assert.equal(active.maxTurns,3);assert.equal(active.stages.length,2);});
    let calls=0;
    const empty=harness({fetch:async()=>({ok:true,json:async()=>++calls===1?{choices:[{message:{content:''},finish_reason:'stop'}]}:{choices:[{message:{content:raw},finish_reason:'stop'}]}})});
    const recovered=await empty.api.askLLM(empty.api.EVENT_TYPES.combat,'成年教练对练',{...empty.api.DEFAULT_SETTINGS,apiKey:'test-only',baseUrl:'https://example.invalid/v1'},'test');
    check('Transient empty response retries once and recovers',()=>{assert.equal(calls,2);assert.equal(recovered,raw);});
    check('XML exactly N slips and separated archive',()=>{assert.equal(event.stages.length,2);assert(!event.stages[0].content.includes('SECRET'));});
    check('Incomplete output fails closed',()=>{assert.throws(()=>h.api.EventInjectionTool.parse('无法解析的大纲 SECRET',2));assert.throws(()=>h.api.EventInjectionTool.parse(raw,3));assert.throws(()=>h.api.EventInjectionTool.parse(raw.replace('segment_2','segment_1'),2));});
    check('Markdown heading variants and archive separation',()=>{const p=h.api.EventInjectionTool.parse('### 后台暗箱核心档案\n秘密\n**第 1 轮小纸条**\n首轮线索\n【第二轮】\n收束现场\n### Good End\n成功条件\n### Bad End\n受阻条件',2);assert.equal(p.stages.length,2);assert(!p.stages[1].content.includes('成功条件'));});
    check('Loose trigger supports wrappers and spaces but not incidental references',()=>{assert.equal(h.api.findTriggeredEvent('【突发事件】 推理事件（c 0 0 0 1）').id,event.id);assert.equal(h.api.findTriggeredEvent('我觉得刚才c0001这个事件不错'),null);assert.equal(h.api.findTriggeredEvent('c00010'),null);});
    h.ctx.chat.push({is_user:true,mes:'【突发事件】 推理事件（c 0 0 0 1）'});
    await h.emit('GENERATION_STARTED','normal',{},false);await h.emit('MESSAGE_SENT',0);
    const first=request(h,h.ctx.chat[0].mes,true);
    await h.emit('CHAT_COMPLETION_PROMPT_READY',first);
    check('Round 1 preserves player input and injects dedicated system directive',()=>{const player=first.chat.find(m=>m.role==='user'&&m.content.includes(h.ctx.chat[0].mes));const injected=first.chat.find(m=>m.role==='system'&&m.content.includes('ROUND_ONE_123'));assert(player);assert(!player.content.includes('ROUND_ONE_123'));assert(injected);assert(injected.content.includes('<st_direct_slip>'));assert(!first.chat.find(m=>m.content.includes('这是预设结尾指示')).content.includes('ROUND_ONE'));assert(!text(first).includes('SECRET'));assert(!text(first).includes('ROUND_TWO'));});
    await h.emit('CHAT_COMPLETION_PROMPT_READY',first);
    check('Repeated hook injects once',()=>assert.equal((text(first).match(/<st_direct_slip>/g)||[]).length,1));
    h.ctx.chat.push({is_user:false,mes:'卡片不见了，管理员询问先查看哪里。'});
    await h.emit('MESSAGE_RECEIVED',1,'normal');await h.emit('GENERATION_ENDED',2);await h.emit('MESSAGE_RECEIVED',1,'normal');
    check('One received reply advances exactly once',()=>assert.equal(h.api.getChatState().activeEvent.currentTurn,2));
    h.ctx.chat.push({is_user:true,mes:'我查看桌边的空盒子，并询问卡片有没有被收进去。'});
    await h.emit('GENERATION_STARTED','normal',{},false);const second=request(h,h.ctx.chat[2].mes,true,true);await h.emit('CHAT_COMPLETION_PROMPT_READY',second);
    check('Round 2 preserves player action and image while injecting system directive with final evidence',()=>{const player=second.chat.find(m=>m.role==='user'&&Array.isArray(m.content));const parts=player.content;assert.equal(parts[0].type,'image_url');assert(parts[1].text.includes(h.ctx.chat[2].mes));assert(!parts[1].text.includes('ROUND_TWO_456'));const injected=second.chat.find(m=>m.role==='system'&&m.content.includes('ROUND_TWO_456'));assert(injected);assert(injected.content.includes('SECRET_CULPRIT_812'));assert(!text(second).includes('ROUND_ONE_123'));});
    await h.emit('GENERATION_STOPPED');h.ctx.chat.push({is_user:false,mes:'未完成片段'});await h.emit('MESSAGE_RECEIVED',3,'normal');
    check('Stop does not consume a turn',()=>assert.equal(h.api.getChatState().activeEvent.currentTurn,2));
    h.ctx.chat.pop();await h.emit('GENERATION_STARTED','normal',{},false);const retry=request(h,h.ctx.chat[2].mes);await h.emit('CHAT_COMPLETION_PROMPT_READY',retry);h.ctx.chat.push({is_user:false,mes:'盒子里找到卡片。'});await h.emit('MESSAGE_RECEIVED',3,'normal');
    check('Final reply ends event and clears extension prompt',()=>{assert.equal(h.api.getChatState().activeEvent.isActive,false);assert.equal(h.ctx.injection,'');});
    await h.emit('GENERATION_STARTED','swipe',{},false);const swipe=request(h,h.ctx.chat[2].mes);await h.emit('CHAT_COMPLETION_PROMPT_READY',swipe);await h.emit('MESSAGE_RECEIVED',3,'swipe');
    check('Reroll uses original final slip and never advances',()=>{assert(text(swipe).includes('ROUND_TWO_456'));assert.equal(h.api.getChatState().activeEvent.currentTurn,3);});
    h.ctx.chat.splice(3);await h.emit('MESSAGE_DELETED',3);
    check('Deleting final reply restores correct round',()=>{assert.equal(h.api.getChatState().activeEvent.currentTurn,2);assert.equal(h.api.getChatState().activeEvent.isActive,true);});
    await h.emit('GENERATION_STARTED','quiet',{},false);const quiet=request(h,'后台摘要');await h.emit('CHAT_COMPLETION_PROMPT_READY',quiet);
    check('Quiet generation gets no event directive',()=>assert(!text(quiet).includes('ROUND_')));
    await h.emit('GENERATION_STARTED','normal',{},false);const dry={...request(h,'测试'),dryRun:true};const before=JSON.stringify(dry);await h.emit('CHAT_COMPLETION_PROMPT_READY',dry);
    check('Dry run does not mutate API messages',()=>assert.equal(JSON.stringify(dry),before));
    h.ctx.chatId='another';h.ctx.chatMetadata={};h.ctx.chat=[{is_user:true,mes:'你好'}];await h.emit('CHAT_CHANGED');const fresh=request(h,'你好');await h.emit('CHAT_COMPLETION_PROMPT_READY',fresh);
    check('Chat switch clears pending state and secrets',()=>assert(!text(fresh).includes('SECRET')));
    const h2=harness();const e2=seed(h2);h2.ctx.chat.push({is_user:true,mes:'c0001'});const unbound=request(h2,'c0001');await h2.emit('CHAT_COMPLETION_PROMPT_READY',unbound);
    check('Missed MESSAGE_SENT has explicit hook fallback',()=>assert(text(unbound).includes('ROUND_ONE')));
    const old=h2.api.getChatState().activeEvent;delete h2.api.getChatState().activeEvent;const memory=request(h2,'c0001');await h2.emit('CHAT_COMPLETION_PROMPT_READY',memory);
    check('Same-chat memory fallback restores active state',()=>assert.equal(h2.api.getChatState().activeEvent,old));
    const txt={prompt:'已有上下文\n<interactive_input>玩家原话</interactive_input>\n预设尾部'};await h2.emit('GENERATE_AFTER_COMBINE_PROMPTS',txt);
    check('Text completion fallback preserves input and isolates round',()=>{assert(txt.prompt.includes('玩家原话'));assert(!txt.prompt.includes('SECRET'));assert(/\[System Directive:[\s\S]*ROUND_ONE/.test(txt.prompt));});
    check('Context cleaner removes all director content and thinking',()=>{const clean=h2.api.cleanRecentContext('正文<director_event>SECRET_A</director_event><st_direct_slip>SECRET_B</st_direct_slip><event_archive>SECRET_C</event_archive><thinking>SECRET_D</thinking>继续');assert.equal(clean,'正文继续');});
    check('Single round has no contradictory do-not-finish instruction',()=>{const h3=harness();const e=seed(h3,1);assert(!h3.api.buildDynamicSlipStructure(1,'reasoning').includes('严禁一回合'));assert(h3.api.EventInjectionTool.buildSegmentPrompt(e,1,1).includes('SECRET_CULPRIT'));});
    check('Budget stretch never exposes final slip early',()=>{assert(!h2.api.EventInjectionTool.buildSegmentPrompt(e2,2,3).includes('SECRET'));assert(!h2.api.EventInjectionTool.buildSegmentPrompt(e2,2,3).includes('ROUND_TWO'));});
    check('Rewind replans so current slip rejoins even spread',()=>{
        const t=harness();
        const active={id:'x',type:'reasoning',stages:[{index:1,title:'A',content:'SLIP_ONE'},{index:2,title:'B',content:'SLIP_TWO'}],maxTurns:5,currentTurn:1,stagePlan:[[0],[1],[1],[1],[1]]};
        t.api.replanFromCurrent(active,1);
        assert.equal(JSON.stringify(active.stagePlan),'[[0],[0],[1],[1],[1]]');
        active.currentTurn=2;
        const prompt=t.api.buildActiveStagePrompt(active);
        assert(prompt.includes('SLIP_ONE'));
        assert(!prompt.includes('SLIP_TWO'));
        assert.equal(JSON.stringify(active.stagePlan[4]),'[1]');
    });
    check('Rewind replan stays stable on even plans and keeps final slip last',()=>{
        const t=harness();
        const active={id:'y',type:'reasoning',stages:Array.from({length:3},(_,i)=>({index:i+1,title:String(i+1),content:'CONTENT_'+i})),maxTurns:8,currentTurn:3,stagePlan:[[0],[0],[1],[1],[1],[2],[2],[2]]};
        t.api.replanFromCurrent(active,3);
        assert.equal(JSON.stringify(active.stagePlan),'[[0],[0],[1],[1],[1],[2],[2],[2]]');
        t.api.replanFromCurrent(active,8);
        assert.equal(JSON.stringify(active.stagePlan[7]),'[2]');
    });
    check('Settings honor zero temperature and authoritative config version',()=>{h2.ctx.extensionSettings['st-direct-event']={temperature:0,configVersion:6,model:'new'};h2.local.set('st_direct_event_settings_v1',JSON.stringify({model:'old',configVersion:5}));assert.equal(h2.api.getSettings().model,'new');assert.equal(h2.api.getSettings().temperature,0);});
    check('Empty model in localStorage never overrides a valid server model',()=>{
        const hz=harness();
        hz.ctx.extensionSettings['st-direct-event']={model:'deepseek-chat',configVersion:7};
        hz.local.set('st_direct_event_settings_v1',JSON.stringify({model:'',configVersion:7}));
        assert.equal(hz.api.getSettings().model,'deepseek-chat');
    });
    check('persistSettings never writes an empty model name',()=>{
        const hz=harness();
        hz.ctx.extensionSettings['st-direct-event']={model:'deepseek-chat',configVersion:7};
        hz.local.set('st_direct_event_settings_v1',JSON.stringify({model:'deepseek-chat',configVersion:7}));
        hz.api.persistSettings({model:''});
        assert.equal(hz.api.getSettings().model,'deepseek-chat');
        const ls=JSON.parse(hz.local.get('st_direct_event_settings_v1'));
        assert(ls.model);
        assert.notEqual(ls.model,'');
    });
    const gen=harness({fetch:async()=>({ok:true,json:async()=>({choices:[{message:{content:raw}}]})})});
    const settings={...gen.api.DEFAULT_SETTINGS,apiKey:'test-only',baseUrl:'https://example.invalid/v1',autoSend:false,enableJailbreak:false,enableNovelBypass:false};
    await gen.api.generateAndSave(gen.api.EVENT_TYPES.reasoning,settings);
    check('Generation saves without popup or activation when auto-send is off',()=>{assert(!gen.sandbox.modalOpened);assert(!gen.api.getChatState().activeEvent);assert.equal(gen.api.getChatState().events.length,1);});
    const raw6 = '<event_archive>SECRET_CASE_666：凶手是管家。</event_archive>\n<segment_1 title="一">SEG_1_CONTENT</segment_1>\n<segment_2 title="二">SEG_2_CONTENT</segment_2>\n<segment_3 title="三">SEG_3_CONTENT</segment_3>\n<segment_4 title="四">SEG_4_CONTENT</segment_4>\n<segment_5 title="五">SEG_5_CONTENT</segment_5>\n<segment_6 title="六">SEG_6_CONTENT</segment_6>\n<event_endings>Good End：结案\nBad End：未解</event_endings>';
    const h6 = harness();
    const p6 = h6.api.EventInjectionTool.parse(raw6, 6);
    const e6 = { id: '推理事件c0006', title: '六回合案', type: 'reasoning', content: raw6, maxTurns: 6, ...p6 };
    h6.api.getChatState().events.push(e6);
    h6.ctx.chat.push({ is_user: true, mes: '【突发事件】六回合案 (推理事件c0006)' });
    await h6.emit('GENERATION_STARTED', 'normal', {}, false);
    await h6.emit('MESSAGE_SENT', 0);
    const act6 = h6.api.getChatState().activeEvent;
    const r1 = request(h6, h6.ctx.chat[0].mes);
    await h6.emit('CHAT_COMPLETION_PROMPT_READY', r1);
    h6.ctx.chat.push({ is_user: false, mes: '第一轮回复' });
    h6.ctx.chatMetadata = { ...h6.ctx.chatMetadata };
    await h6.emit('MESSAGE_RECEIVED', 1, 'normal');
    let sixRoundsOk = act6.currentTurn === 2 && text(r1).includes('SEG_1_CONTENT') && !text(r1).includes('SECRET_CASE_666');
    for (let turn = 2; turn <= 6; turn++) {
        h6.ctx.chat.push({ is_user: true, mes: `第${turn}轮玩家行动` });
        const uIdx = h6.ctx.chat.length - 1;
        await h6.emit('GENERATION_STARTED', 'normal', {}, false);
        await h6.emit('MESSAGE_SENT', uIdx);
        const reqTurn = request(h6, h6.ctx.chat[uIdx].mes);
        await h6.emit('CHAT_COMPLETION_PROMPT_READY', reqTurn);
        if (!text(reqTurn).includes(`SEG_${turn}_CONTENT`)) sixRoundsOk = false;
        if (turn < 6 && text(reqTurn).includes('SECRET_CASE_666')) sixRoundsOk = false;
        if (turn === 6 && !text(reqTurn).includes('SECRET_CASE_666')) sixRoundsOk = false;
        h6.ctx.chat.push({ is_user: false, mes: `第${turn}轮回复` });
        h6.ctx.chatMetadata = { ...h6.ctx.chatMetadata };
        await h6.emit('MESSAGE_RECEIVED', h6.ctx.chat.length - 1, 'normal');
        if (turn < 6) {
            if (act6.currentTurn !== turn + 1 || !act6.isActive) sixRoundsOk = false;
        } else {
            if (act6.isActive || h6.ctx.injection !== '') sixRoundsOk = false;
        }
    }
    assert.equal(sixRoundsOk, true, 'Six rounds progression failed assertion');
    check('Six rounds progression completes without leaking secrets', () => { assert.equal(sixRoundsOk, true); });
    const zlib = require('node:zlib');
    const gzipPayload = zlib.gzipSync(Buffer.from(JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] })));
    const gzH = harness({ fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => gzipPayload.buffer.slice(gzipPayload.byteOffset, gzipPayload.byteOffset + gzipPayload.byteLength) }) });
    const gzRes = await gzH.api.askLLM(gzH.api.EVENT_TYPES.combat, '成年教练对练', { ...gzH.api.DEFAULT_SETTINGS, apiKey: 'test-only', baseUrl: 'https://example.invalid/v1' }, 'test');
    check('Gzip compressed response decompresses automatically and succeeds', () => { assert.equal(gzRes, raw); });

    const zstdFixturePath = path.join(__dirname, 'fixtures/models.zstd');
    if (fs.existsSync(zstdFixturePath)) {
        const zstdBuf = fs.readFileSync(zstdFixturePath);
        const zstdH = harness({ fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => zstdBuf.buffer.slice(zstdBuf.byteOffset, zstdBuf.byteOffset + zstdBuf.byteLength) }) });
        const zstdParsed = await zstdH.api.safeParseJsonResponse({ ok: true, status: 200, arrayBuffer: async () => zstdBuf.buffer.slice(zstdBuf.byteOffset, zstdBuf.byteOffset + zstdBuf.byteLength) }, 'ZstdFixture');
        check('Zstd compressed binary stream decompresses automatically and succeeds', () => {
            assert(Array.isArray(zstdParsed.data));
            assert(zstdParsed.data.length > 0);
        });
    }

    const htmlPayload = Buffer.from('<html><head><title>502 Bad Gateway</title></head><body>Bad Gateway</body></html>');
    const htmlH = harness({ fetch: async () => ({ ok: false, status: 502, arrayBuffer: async () => htmlPayload.buffer.slice(htmlPayload.byteOffset, htmlPayload.byteOffset + htmlPayload.byteLength) }) });
    await assert.rejects(() => htmlH.api.askLLM(htmlH.api.EVENT_TYPES.combat, '测试', { ...htmlH.api.DEFAULT_SETTINGS, apiKey: 'test-only', baseUrl: 'https://example.invalid/v1' }, 'test'), /502/);
    check('HTML gateway error produces clear diagnostic', () => { assert.ok(true); });

    // ===== 修复回归：生成中胶囊守卫 / 手动发送切聊防护 / 删除清理 / swipe 过滤 / 恢复保进度 / 设置位置保留 =====
    const guard = harness();
    seed(guard);
    guard.ctx.chat.push({is_user:true, mes:'【突发事件】 推理事件（c 0 0 0 1）'});
    await guard.emit('GENERATION_STARTED','normal',{},false);
    await guard.emit('MESSAGE_SENT',0);
    await guard.api.handleCapsuleAction('advance-turn');
    await guard.api.handleCapsuleAction('climax');
    check('Capsule advance and climax are blocked while the main model is replying',()=>{
        assert.equal(guard.api.isMainGenerationBusy(), true);
        assert.equal(guard.api.getChatState().activeEvent.currentTurn, 1);
    });
    await guard.emit('GENERATION_ENDED', guard.ctx.chat.length);
    await guard.api.handleCapsuleAction('advance-turn');
    check('Capsule advance works again once the reply lands',()=>{
        assert.equal(guard.api.isMainGenerationBusy(), false);
        assert.equal(guard.api.getChatState().activeEvent.currentTurn, 2);
    });
    const sm = harness();
    await assert.rejects(() => sm.api.sendEventTrigger(seed(sm), 'other-chat'), /聊天已切换/);
    check('Manual send honors the chat-switch guard',()=>{ assert.ok(true); });
    check('Manual send carries current chat id through to sendEventTrigger',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(src.includes('handleManualSend(event, getCtx()?.chatId)'));
        assert(src.includes('async function handleManualSend(event, targetChatId = null)'));
        assert(src.includes('await sendEventTrigger(event, targetChatId)'));
    });
    const del = harness();
    seed(del);
    del.ctx.chat.push({is_user:true, mes:'【突发事件】 推理事件（c 0 0 0 1）'});
    await del.emit('MESSAGE_SENT',0);
    assert(del.api.getChatState().activeEvent);
    await del.api.deleteEventById('推理事件c0001');
    check('Deleting the active event clears zombie state and injection',()=>{
        assert.equal(del.api.getChatState().activeEvent, null);
        assert.equal(del.ctx.injection, '');
        assert.equal(del.api.getChatState().events.length, 0);
    });
    const sw = harness();
    seed(sw);
    await sw.api.setActiveEventById('推理事件c0001');
    sw.ctx.chat.push({is_user:false, mes:'激活前就存在的回复'});
    await sw.emit('GENERATION_STARTED','swipe',{},false);
    await sw.emit('MESSAGE_RECEIVED', 0, 'swipe');
    await sw.emit('GENERATION_ENDED', sw.ctx.chat.length);
    check('Swipe on an unmarked floor never consumes a turn',()=>{
        assert.equal(sw.api.getChatState().activeEvent.currentTurn, 1);
    });
    sw.ctx.chat.push({is_user:false, mes:'正常回复'});
    await sw.emit('GENERATION_STARTED','normal',{},false);
    await sw.emit('MESSAGE_RECEIVED', sw.ctx.chat.length - 1, 'normal');
    check('Normal replies still advance after the swipe filter',()=>{
        assert.equal(sw.api.getChatState().activeEvent.currentTurn, 2);
    });
    const rs = harness();
    seed(rs);
    rs.ctx.chat.push({is_user:true, mes:'【突发事件】 推理事件（c 0 0 0 1）'});
    await rs.emit('GENERATION_STARTED','normal',{},false);
    await rs.emit('MESSAGE_SENT',0);
    rs.ctx.chat.push({is_user:false, mes:'第一轮回复'});
    await rs.emit('MESSAGE_RECEIVED',1,'normal');
    assert.equal(rs.api.getChatState().activeEvent.currentTurn, 2);
    await rs.api.stopActiveEvent();
    await rs.api.setActiveEventById('推理事件c0001');
    check('Panel toggle resume keeps turn progress and reinjects current slip',()=>{
        const active = rs.api.getChatState().activeEvent;
        assert.equal(active.currentTurn, 2);
        assert.equal(active.isActive, true);
        assert(rs.ctx.injection.includes('ROUND_TWO_456'));
        assert(!rs.ctx.injection.includes('ROUND_ONE_123'));
    });
    const pos = harness();
    pos.api.persistSettings({model:'deepseek-chat', capsuleX: 120, capsuleY: 40, panelX: 55, panelY: 66, fabX: 11, fabY: 22});
    const form = pos.api.collectSettingsForm();
    check('Saving settings keeps capsule and panel positions',()=>{
        assert.equal(form.capsuleX, 120);
        assert.equal(form.capsuleY, 40);
        assert.equal(form.panelX, 55);
        assert.equal(form.panelY, 66);
        assert.equal(form.fabX, 11);
        assert.equal(form.fabY, 22);
    });
    check('Enemy profile in generation toast is HTML-escaped',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(src.includes('${escapeHtml(event.enemyProfile)}'));
    });
    check('Global UI listeners are registered idempotently',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(src.includes("window.removeEventListener('resize', onWindowResizeUI)"));
        assert(src.includes("window.addEventListener('resize', onWindowResizeUI)"));
        assert(!src.includes('onDocumentClickUI'));
    });
    check('Chat switch closes all plugin windows',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(src.includes('function closeAllUiWindows()'));
        const start = src.indexOf('const chatChanged = () => {');
        assert(start >= 0, 'chatChanged handler not found');
        const end = src.indexOf('};', start);
        assert(src.slice(start, end).includes('closeAllUiWindows()'), 'chatChanged does not call closeAllUiWindows');
    });
    check('World info injection has no hidden truncation caps',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(!src.includes('已达到最大 15 条条目上限'), 'entry-count cap notice still present');
        assert(!src.includes('其余世界书条目已按长度限制截断'), 'length cap notice still present');
        const start = src.indexOf('function buildWorldInfoSystemPrompt');
        const body = src.slice(start, src.indexOf('return lines.join', start));
        assert(!body.includes('6000'), 'hardcoded 6000-char cap still in buildWorldInfoSystemPrompt');
        assert(!body.includes('i >= 15'), 'hardcoded 15-entry cap still in buildWorldInfoSystemPrompt');
    });
    check('Custom context extract/exclude rules are wired',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(src.includes('function applyCustomContextRules'));
        assert(src.includes('contextExtractTags'));
        assert(src.includes('contextExcludeTags'));
        assert((src.match(/cleanRecentContext\(applyCustomContextRules\(/g) || []).length >= 3, 'rules not applied before built-in cleaning at call sites');
        assert(src.includes('id="se-context-extract-tags"'));
        assert(src.includes('id="se-context-exclude-tags"'));
    });
    check('Settings modal separates API and context sections',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(src.includes('>API 设置<'));
        assert(src.includes('>世界书与上下文设置<'));
        assert(src.includes('>通用<'));
        assert((src.match(/se-settings-section-title/g) || []).length >= 3, 'section titles missing');
        assert((src.match(/class="se-settings-section"/g) || []).length >= 3, 'section wrapper cards missing');
    });
    check('Settings small tips have explicit theme color',()=>{
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
        assert(/\.se-settings-body small\s*{[^}]*color:\s*var\(--se-text-muted\)/.test(css), 'small tip color rule missing (dark-on-dark)');
    });
    check('Cream light theme is fully registered',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
        assert(src.includes("id: 'cream'"), 'THEMES entry missing');
        assert(src.includes('value="cream"'), 'theme select option missing');
        assert(css.includes('[data-theme="cream"]'), 'theme variable block missing');
        const block = css.slice(css.indexOf('[data-theme="cream"]'), css.indexOf('/* 极简极夜'));
        for (const key of ['--se-bg-panel','--se-bg-card','--se-bg-input','--se-accent','--se-text-title','--se-text-main','--se-text-sub','--se-text-muted','--se-btn-bg','--se-shadow','--se-badge-bg']) {
            assert(block.includes(key), `cream theme missing ${key}`);
        }
        // 亮色主题：文字必须比背景暗
        const title = block.match(/--se-text-title: *(#[0-9a-f]{6})/)[1];
        const panel = block.match(/--se-bg-panel: *(#[0-9a-f]{6})/)[1];
        const lum = h => [1,3,5].reduce((a,i)=>a+parseInt(h.slice(i,i+2),16),0)/3;
        assert(lum(title) < lum(panel), 'cream theme text darker than panel expected');
    });
    check('World info injection sorts entries by order ascending',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const start = src.indexOf('async function refreshWorldInfoCache');
        const body = src.slice(start, src.indexOf('function buildWorldInfoSystemPrompt', start));
        assert(body.includes('rawEntries.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))'), 'order-ascending sort missing');
    });
    check('Danger/good semantic colors are theme-aware',()=>{
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
        const creamBlock = css.slice(css.indexOf('[data-theme="cream"]'), css.indexOf('/* 极简极夜'));
        for (const key of ['--se-danger-bg','--se-danger-border','--se-danger-title','--se-danger-text','--se-good-title','--se-good-text']) {
            assert(css.includes(key), `semantic variable ${key} missing from base block`);
            assert(creamBlock.includes(key), `cream override missing ${key}`);
        }
        assert(/\.se-secret-desc\s*{[^}]*color:\s*var\(--se-danger-text\)/.test(css), 'se-secret-desc not using semantic variable');
        assert(/\.se-enemy-profile-desc\s*{[^}]*color:\s*var\(--se-danger-text\)/.test(css), 'se-enemy-profile-desc not using semantic variable');
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(src.includes('color:var(--se-good-title)') && src.includes('color:var(--se-danger-title)'), 'Good/Bad End inline colors not theme-aware');
    });
    check('Floating capsule offers climax instead of rewind/advance',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const start = src.indexOf('function updateFloatingCapsule');
        const body = src.slice(start, src.indexOf('function handleCapsuleAction', start));
        assert(body.includes('data-capsule-action="climax"'), 'capsule missing climax button');
        assert(!body.includes('rewind-turn') && !body.includes('advance-turn'), 'capsule still has rewind/advance buttons');
        const engine = src.slice(src.indexOf('function updateEnginePanelCard'));
        assert(engine.includes('data-capsule-action="rewind-turn"'), 'panel engine card lost rewind button');
    });
    check('Cream theme readability fixes are in place',()=>{
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
        assert(css.includes('.se-event-turns-input::-webkit-inner-spin-button'), 'number spinner hide rule missing');
        assert(/\.se-event-head-switch\s*{[^}]*background:\s*var\(--se-bg-input\)/.test(css), 'event head switch still hardcoded dark');
        assert(/\.se-event-head-switch\s*{[^}]*white-space:\s*nowrap/.test(css), 'event head switch nowrap missing');
        assert(/\.se-sub-turn-num\s*{[^}]*color:\s*var\(--se-text-title\)/.test(css), 'sub turn number still hardcoded white');
        assert(css.includes('[data-theme="cream"] .se-pill-gold'), 'cream pill text overrides missing');
        assert(css.includes('.se-engine-btn-group'), 'engine button group style missing');
    });
    check('Section titles are collapsible in settings and sub modal',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
        assert((src.match(/data-action="toggle-section"/g) || []).length >= 9, 'toggle-section titles missing (3 settings + 6 sub)');
        assert(src.includes("action === 'toggle-section'"), 'toggle-section handler missing');
        assert(css.includes('.se-settings-section.se-section-collapsed > *:not(.se-settings-section-title)'), 'collapsed CSS missing');
        assert(css.includes('.se-section-chevron'), 'chevron style missing');
    });
    check('Preset workshop renamed and offers difficulty presets',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(src.includes('>预设工坊<'), 'workshop title not renamed');
        assert(!src.includes('>事件与创作约定<'), 'old workshop title still present');
        // 难度卡由 SUB_CONFIGS 动态生成：验证模板键与死线卡
        assert(src.includes('data-sub-prompt-key="${pKey}.${diffKey}"'), 'workshop difficulty cards missing');
        assert(src.includes('data-sub-prompt-key="combat.death_risk"'), 'workshop missing death_risk card');
        // 736d4bb 重构后：难度/浓度小节为各题材手风琴内的 subSection（键形如 presets-combat-diff），死线小节独立
        assert(src.includes('档 + 自定义）'), 'difficulty accordion group missing');
        assert(src.includes('subSection(`presets-${key}-diff`'), 'difficulty subSection missing');
        assert(src.includes('自定义此档提示词'), 'difficulty inline editor missing');
    });
    check('Difficulty prompts resolve through getSubPrompt fallback',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const fn = src.slice(src.indexOf('function getSubPrompt'), src.indexOf('function getPreset'));
        assert(fn.includes("diff_${d.key}") || fn.includes("'diff_' + d.key"), 'difficulty fallback missing in getSubPrompt');
        assert(/getSubPrompt\(type\.key,\s*`diff_\$\{activeDiff\.key\}`,\s*settings\)\s*\|\|\s*activeDiff\.prompt/.test(src), 'buildEventPrompt not using difficulty override');
    });
    check('Causal boundary kept only in main-class presets',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(src.includes('const LEGACY_CAUSAL_TAIL'), 'migration constant missing');
        const presetsBlock = src.slice(src.indexOf('const DEFAULT_PRESETS'), src.indexOf('const LEGACY_CAUSAL_TAIL'));
        assert((presetsBlock.match(/因果边界/g) || []).length >= 4, 'main presets should keep causal boundary copies');
        const subBlock = src.slice(src.indexOf('const DEFAULT_SUB_PROMPTS'), src.indexOf('const SUB_CONFIGS'));
        assert(!subBlock.includes('因果边界'), 'sub prompts still contain causal boundary');
        const getSettings = src.slice(src.indexOf('function getSettings'), src.indexOf('function getJailbreakPrompt'));
        assert(getSettings.includes('configVersion = 9'), 'v9 migration version bump missing');
        assert(getSettings.includes('endsWith(LEGACY_CAUSAL_TAIL)'), 'v8 migration strip missing');
        // v9：自定义事件包覆盖层折叠进本体（本体唯一事实源），须在 presets 赋值之后执行
        assert(getSettings.includes('foldCustomOverridesIntoBodies(merged)'), 'v9 fold wiring missing in getSettings');
        assert(src.includes('configVersion: 9'), 'persistSettings must stamp configVersion 9');
    });
    check('Custom template overrides fold into bodies (v9 migration)',()=>{
        const hf = harness();
        // 纯函数直调：烤入覆盖折叠进本体、孤儿键与空值键删除、源对象不被穿透污染
        const tpl = { id: 'ct_f1', prefix: 'e', name: '折叠模板', mainPrompt: '', turns: 2, genres: [{ id: 'g1', label: '流', badge: '', desc: '', prompt: '旧流派' }], depths: [{ id: 'd1', label: '深', desc: '', prompt: '旧深度' }], extras: [{ id: 'x1', label: '额', desc: '', prompt: '旧额外' }], selectedGenreId: 'g1', selectedDepthId: 'd1', selectedExtraIds: ['x1'], createdAt: 1, updatedAt: 1 };
        const sourcePresets = { ct_f1: { systemPrompt: '工坊主覆盖' }, ct_gone: { systemPrompt: '孤儿主覆盖' } };
        const sourceSubs = { 'ct_f1.g1': '工坊流派覆盖', 'ct_f1.diff_d1': '工坊深度覆盖', 'ct_f1.extra_x1': '工坊额外覆盖', 'ct_f1.g999': '无主条目覆盖', 'ct_gone.g1': '孤儿流派覆盖' };
        const target = { customTemplates: [JSON.parse(JSON.stringify(tpl))], presets: sourcePresets, subPrompts: sourceSubs };
        hf.api.foldCustomOverridesIntoBodies(target);
        const folded = target.customTemplates[0];
        assert.equal(folded.mainPrompt, '工坊主覆盖', 'main prompt override must fold into body');
        assert.equal(folded.genres[0].prompt, '工坊流派覆盖', 'genre override must fold into entry');
        assert.equal(folded.depths[0].prompt, '工坊深度覆盖', 'depth override must fold into entry');
        assert.equal(folded.extras[0].prompt, '工坊额外覆盖', 'extra override must fold into entry');
        assert(target.presets && !('ct_f1' in target.presets) && !('ct_gone' in target.presets), 'folded preset keys must be removed');
        assert(target.subPrompts && Object.keys(target.subPrompts).length === 0, 'folded/orphan subPrompt keys must be removed');
        assert.deepEqual(sourcePresets, { ct_f1: { systemPrompt: '工坊主覆盖' }, ct_gone: { systemPrompt: '孤儿主覆盖' } }, 'fold must not mutate the source presets object');
        // 空串覆盖是「已清空」状态：仅删键、不写本体
        const emptyFold = { customTemplates: [JSON.parse(JSON.stringify(tpl))], presets: { ct_f1: { systemPrompt: '   ' } }, subPrompts: { 'ct_f1.g1': '' } };
        hf.api.foldCustomOverridesIntoBodies(emptyFold);
        assert.equal(emptyFold.customTemplates[0].mainPrompt, '', 'empty main override must not overwrite body');
        assert.equal(emptyFold.customTemplates[0].genres[0].prompt, '旧流派', 'empty genre override must not overwrite body');
        // 端到端：旧存档（configVersion 8 + 烤入覆盖）经 getSettings 读出即完成折叠
        hf.api.persistSettings({ ...hf.api.DEFAULT_SETTINGS, customTemplates: [tpl], presets: { ct_f1: { systemPrompt: '主覆盖' } }, subPrompts: { 'ct_f1.g1': '流派覆盖' } });
        // 手动把存档版本退回 v8 模拟旧数据（persistSettings 总是写 v9）
        const ctxSettings = hf.ctx.extensionSettings['st-direct-event'];
        ctxSettings.configVersion = 8;
        const loaded = hf.api.getSettings();
        assert.equal(loaded.customTemplates[0].mainPrompt, '主覆盖', 'migration must fold main override on read');
        assert.equal(loaded.customTemplates[0].genres[0].prompt, '流派覆盖', 'migration must fold genre override on read');
        assert(!loaded.presets?.ct_f1, 'migration must drop folded preset key');
        assert(!loaded.subPrompts?.['ct_f1.g1'], 'migration must drop folded subPrompt key');
    });
    check('Engine actions use uniform segmented grid',()=>{
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
        const idx = css.indexOf('.se-stage-engine-actions {');
        const block = css.slice(idx, css.indexOf('}', idx));
        assert(block.includes('grid'), 'engine actions not a grid');
        assert(/\.se-engine-btn-group\s*{\s*display:\s*contents/.test(css), 'group display:contents missing');
        assert(/#st-direct-event-root \.se-stage-engine-actions \.se-cap-btn\s*{[^}]*width:\s*100%/.test(css), 'uniform button sizing missing');
    });

    check('Tavern variable injection toggle is wired end to end',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(src.includes('enableVarInjection: true'), 'DEFAULT_SETTINGS default missing');
        assert(src.includes('merged.enableVarInjection = (ls.enableVarInjection ?? stored.enableVarInjection) !== false;'), 'getSettings merge missing');
        assert(src.includes('id="se-enable-var-injection"'), 'settings toggle missing');
        assert(src.includes("setChecked('se-enable-var-injection', s.enableVarInjection !== false);"), 'form fill missing');
        assert(src.includes("enableVarInjection: checked('se-enable-var-injection')"), 'form collect missing');
        assert(src.includes('data-pv-action="toggle-variables"'), 'prompt viewer toggle missing');
        assert(src.includes('promptViewerState.variables = s.enableVarInjection !== false;'), 'prompt viewer state sync missing');
        assert(src.includes('id="se-variable-modal"'), 'variable modal shell missing');
        assert(src.includes('data-action="open-variable-modal"'), 'variable modal open button missing');
        assert(src.includes('merged.varInjectionSelections = ls.varInjectionSelections != null ? ls.varInjectionSelections : (stored.varInjectionSelections != null ? stored.varInjectionSelections : null);'), 'selections merge missing');
        assert(src.includes('merged.varPruneEmpty = (ls.varPruneEmpty ?? stored.varPruneEmpty) !== false;'), 'prune merge missing');
        assert(src.includes('varInjectionSelections: current.varInjectionSelections || null,'), 'form preserve selections missing');
        assert(src.includes('varPruneEmpty: current.varPruneEmpty !== false,'), 'form preserve prune missing');
    });
    check('Change listener handles DOM checkboxes before the pv-action guard',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const guard = src.indexOf('if (!pvActionEl) return;');
        assert(guard > 0, 'pv-action guard missing');
        // 回归：var/wi 复选框与弹窗开关的处理分支曾被守卫吞掉导致勾选保存无效，必须位于守卫之前
        assert(src.indexOf("e.target.closest('.se-var-checkbox')") < guard, 'var checkbox branch after the guard (dead code)');
        assert(src.indexOf("e.target.closest('.se-wi-checkbox')") < guard, 'wi checkbox branch after the guard (dead code)');
        assert(src.indexOf("e.target.id === 'se-var-prune-empty'") < guard, 'prune toggle branch after the guard (dead code)');
        assert(src.indexOf("e.target.id === 'se-pv-filter-match'") < guard, 'pv filter-match branch after the guard (dead code)');
        // 保存兜底：saveVariableModal 必须先从 DOM 重读勾选状态
        assert(src.includes('function syncVariableSelectionsFromDom'), 'dom sync helper missing');
        const saveHead = src.slice(src.indexOf('async function saveVariableModal'), src.indexOf('async function saveVariableModal') + 400);
        assert(saveHead.includes('syncVariableSelectionsFromDom();'), 'saveVariableModal does not sync from DOM');
    });
    check('WI/var modal search boxes use in-flow svg layout like the prompt viewer',()=>{
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8').replace(/\r\n/g, '\n');
        const svgStart = css.indexOf('.se-wi-search-box svg {');
        const svgBlock = css.slice(svgStart, css.indexOf('}', svgStart));
        assert(!svgBlock.includes('position: absolute'), 'search svg must not be absolutely positioned (overlaps text when host overrides input padding)');
        assert(svgBlock.includes('flex-shrink: 0'), 'search svg must be an in-flow flex item');
        const inputStart = css.indexOf('#st-direct-event-root .se-wi-search-input {\n    flex: 1;');
        const inputBlock = css.slice(inputStart, css.indexOf('}', inputStart));
        assert(!inputBlock.includes('30px'), 'search input must not rely on left padding to avoid the icon');
        assert(inputBlock.includes('flex: 1') && inputBlock.includes('min-width: 0'), 'search input must flex within the box');
    });
    check('Variable section is injected between world info and sub-prompt',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const wi = src.indexOf('// 2. 独立注入：世界书核心设定');
        const va = src.indexOf('// 3. 独立注入：酒馆变量');
        const sp = src.indexOf('// 4. 独立注入：专属细分流派与难度设定');
        const tn = src.indexOf('// 5. 独立注入：回合推进规约与XML大纲结构');
        assert(wi >= 0 && va > wi && sp > va && tn > sp, 'variable push not between world info and sub prompt');
        const body = src.slice(src.indexOf('function buildEventPrompt'), src.indexOf('function pushApiLog'));
        assert(body.includes('buildVariablesSystemPrompt(collectTavernVariables(settings))'), 'buildEventPrompt does not build variable content with settings');
        assert(body.includes('enableVarInjection !== false'), 'variable content not gated on setting');
    });
    check('Variable prompt builder renders YAML groups and hides $ keys',()=>{
        assert.equal(h.api.DEFAULT_SETTINGS.enableVarInjection, true);
        const out = h.api.buildVariablesSystemPrompt([
            {label:'角色卡变量', variables:{好感度:5, 状态:{体力:'良好', $meta:'hidden'}, 装备:['长剑','盾'], 备注:'多行\n第二行'}},
        ]);
        assert(out.includes('【酒馆变量注入'), 'header missing');
        assert(out.includes('### 【角色卡变量】'), 'group title missing');
        assert(out.includes('好感度: 5'));
        assert(out.includes('体力: 良好'));
        assert(out.includes('- 长剑') && out.includes('- 盾'));
        assert(out.includes('第二行'));
        assert(!out.includes('$meta'), 'hidden $ key leaked');
        assert(!out.includes('hidden'), 'stripped value leaked');
        assert.equal(h.api.buildVariablesSystemPrompt([]), '');
        assert.equal(h.api.buildVariablesSystemPrompt([{label:'聊天变量', variables:{}}]), '');
        assert(h.api.buildVariablesSystemPrompt([{label:'聊天变量', variables:{a:{$secret:1}, $b:2}}]).includes('a: {}'), 'nested $ keys not stripped');
    });
    check('Variable selection defaults to stat_data and honors explicit branches',()=>{
        // 默认规则：未显式标记的顶层键仅 stat_data 注入，其余一律不注入；深层节点继承父级有效状态
        const vars = { stat_data: { hp: 1, NPC: { name: '陈' } }, gold: 9, duihua: '- 对白主导' };
        assert.equal(JSON.stringify(Object.keys(h.api.filterVariablesBySelection(vars, null))), JSON.stringify(['stat_data']));
        // 显式放开顶层键
        const opened = h.api.filterVariablesBySelection(vars, { gold: true, duihua: true });
        assert.equal(JSON.stringify(Object.keys(opened).sort()), JSON.stringify(['duihua','gold','stat_data']));
        // 显式取消 stat_data 整体
        assert.equal(h.api.filterVariablesBySelection(vars, { stat_data: false }).stat_data, undefined);
        // 仅取消 stat_data 子分支，兄弟键保留
        const trimmed = h.api.filterVariablesBySelection(vars, { 'stat_data.NPC': false });
        assert.equal(trimmed.stat_data.hp, 1);
        assert.equal(trimmed.stat_data.NPC, undefined);
        // 父级取消时子级标记被压制：stat_data 整体关闭后，NPC 上的 true 无效
        assert.equal(h.api.filterVariablesBySelection(vars, { stat_data: false, 'stat_data.NPC': true }).stat_data, undefined);
    });
    check('Empty-value pruning is real-time, non-destructive and toggleable',()=>{
        const messy = { a: '', b: {}, c: [], d: null, e: 0, f: false, g: 'x', h: { i: '', j: 'v' } };
        const pruned = h.api.pruneEmptyVariableLeaves(messy);
        assert.equal(JSON.stringify(pruned), JSON.stringify({ e: 0, f: false, g: 'x', h: { j: 'v' } }));
        // 剪枝只作用于注入副本，原变量对象不被修改
        assert.equal(messy.a, '');
        assert.equal(messy.h.i, '');
        // 空容器经剪枝后整体消失
        assert.equal(h.api.pruneEmptyVariableLeaves({ k: { l: [] } }), undefined);
    });
    check('Variable collection honors default stat_data, selections and prune toggle',()=>{
        const fixture = { stat_data: { hp: 110, gold: 9, memo: '' }, gold2: 1, schema: '没有用别管这个', duihua: '- 对白主导' };
        const h4 = harness({ ctx: { chatMetadata: { variables: fixture } } });
        // 默认仅 stat_data，且其中空值被剪除；schema/duihua/gold2 默认不注入
        const groups = h4.api.collectTavernVariables();
        assert.equal(groups.length, 1);
        assert.equal(groups[0].label, '聊天变量');
        assert.equal(JSON.stringify(groups[0].variables), JSON.stringify({ stat_data: { hp: 110, gold: 9 } }));
        // 显式放开顶层键
        const opened = h4.api.collectTavernVariables({ varInjectionSelections: { '聊天变量': { gold2: true, duihua: true } } });
        assert.equal(JSON.stringify(Object.keys(opened[0].variables).sort()), JSON.stringify(['duihua','gold2','stat_data']));
        // 显式取消 stat_data → 整组为空 → 不注入
        assert.equal(h4.api.collectTavernVariables({ varInjectionSelections: { '聊天变量': { stat_data: false } } }).length, 0);
        // 关闭剪枝后空值保留
        const kept = h4.api.collectTavernVariables({ varInjectionSelections: { '聊天变量': { 'stat_data.memo': true } }, varPruneEmpty: false });
        assert.equal(kept[0].variables.stat_data.memo, '');
        // 完全无变量时不注入小节
        const h5 = harness();
        assert.equal(h5.api.collectTavernVariables().length, 0);
        assert(!h5.api.buildEventPrompt(h5.api.EVENT_TYPES.combat, '玩家: 你好', h5.api.DEFAULT_SETTINGS, []).some(m => String(m.content).includes('【酒馆变量注入')), 'empty variables must not push a section');
    });
    check('Custom template settings are wired end to end',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(src.includes('customTemplates: [],'), 'DEFAULT_SETTINGS default missing');
        assert(src.includes('merged.customTemplates = (Array.isArray(ls.customTemplates)'), 'getSettings merge missing');
        assert(src.includes('.map(normalizeCustomTemplate)'), 'template normalization missing');
        assert(src.includes('customTemplates: Array.isArray(current.customTemplates) ? current.customTemplates : [],'), 'form preserve missing');
        assert(src.includes('id="se-custom-template-modal"'), 'editor modal shell missing');
        assert(src.includes('id="se-ct-editor-body"'), 'editor body missing');
        assert(src.includes('id="se-custom-rows"'), 'custom rows container missing');
        assert(src.includes('data-action="create-custom"'), 'create button missing');
        assert(src.includes('data-action="save-custom-template"'), 'save button missing');
        assert(src.includes('data-action="delete-custom"'), 'delete button missing');
        assert(src.includes("sectionToolbar('ct-copy-genre-template'") && src.includes("sectionToolbar('ct-copy-depth-template'") && src.includes("sectionToolbar('ct-copy-extra-template'") && src.includes('data-action="ct-copy-main-template"'), 'copy template buttons missing');
        assert(src.includes("if (action === 'ct-add-genre')") && src.includes("if (action === 'ct-add-depth')") && src.includes("if (action === 'ct-add-extra')"), 'add item actions missing');
        assert(src.includes('function isCustomTemplateComplete'), 'completeness check missing');
        assert(src.includes('function syncCustomEventTypes'), 'event types sync missing');
        assert(src.includes('function saveCustomTemplate'), 'save missing');
        assert(src.includes('function deleteCustomTemplate'), 'delete missing');
        assert(src.includes('function refreshCustomRows'), 'rows refresh missing');
        assert(src.includes('DEFAULT_CUSTOM_MAIN_PROMPT') && src.includes('DEFAULT_CUSTOM_GENRE_PROMPT') && src.includes('DEFAULT_CUSTOM_DEPTH_PROMPT'), 'copyable prompt constants missing');
        // 主面板：自定义行容器必须位于恋爱组与随机事件组之间（含＋新建行）
        const romanceIdx = src.indexOf('data-event="romance"');
        const rowsIdx = src.indexOf('id="se-custom-rows"');
        const randomIdx = src.indexOf('data-event="random"');
        assert(romanceIdx > 0 && rowsIdx > romanceIdx && randomIdx > rowsIdx, 'custom rows not between romance and random');
        // 删除按钮必须二次确认，不允许一次点击直接删
        const delIdx = src.indexOf("if (action === 'delete-custom')");
        const confirmIdx = src.indexOf("if (!el.dataset.confirming)", delIdx);
        const execIdx = src.indexOf('deleteCustomTemplate(el.dataset.template)', delIdx);
        assert(delIdx > 0 && confirmIdx > 0 && execIdx > confirmIdx, 'delete confirm flow missing');
        // 未完成事件包不得触发生成：handleGenerate 内必须有完成度守卫
        const genHead = src.slice(src.indexOf('async function handleGenerate'), src.indexOf('async function handleGenerate') + 900);
        assert(genHead.includes('isCustomTemplateComplete'), 'handleGenerate completeness guard missing');
    });

    check('Custom template completeness gating rules',()=>{
        const h6 = harness();
        const base = { id: 'ct_test1', prefix: 'e', name: '校园试炼', mainPrompt: '', turns: 2, genres: [{ id: 'g1', label: '试炼', badge: '试', desc: '', prompt: '试炼规则' }], depths: [], selectedGenreId: 'g1', selectedDepthId: '', createdAt: 1, updatedAt: 1 };
        assert.equal(h6.api.isCustomTemplateComplete(base), true, 'complete template rejected');
        assert.equal(h6.api.isCustomTemplateComplete({ ...base, name: ' ' }), false, 'blank name must fail');
        assert.equal(h6.api.isCustomTemplateComplete({ ...base, genres: [] }), false, 'no genre must fail');
        assert.equal(h6.api.isCustomTemplateComplete({ ...base, genres: [{ ...base.genres[0], prompt: '' }] }), false, 'genre without prompt must fail');
        assert.equal(h6.api.isCustomTemplateComplete({ ...base, selectedGenreId: 'nope' }), false, 'invalid genre selection must fail');
        assert.equal(h6.api.isCustomTemplateComplete({ ...base, depths: [{ id: 'd1', label: '深', badge: '', desc: '', prompt: '' }] }), false, 'half-filled depth must fail');
        assert.equal(h6.api.isCustomTemplateComplete({ ...base, depths: [{ id: 'd1', label: '深', badge: '', desc: '', prompt: '深度规则' }], selectedDepthId: 'd1' }), true, 'valid depth must pass');
        assert.equal(h6.api.isCustomTemplateComplete({ ...base, selectedDepthId: '' }), true, 'depth is optional');
        assert(h6.api.customTemplateMissingText({ ...base, name: '' }).includes('事件包名'), 'missing text should name the field');
    });

    check('Custom templates register into EVENT_TYPES and build prompts',()=>{
        const h7 = harness();
        const tpl = { id: 'ct_test2', prefix: 'f', name: '校园试炼', mainPrompt: '自定义主提示词内容', turns: 3, genres: [{ id: 'g1', label: '试炼流派', badge: '试', desc: '', prompt: '流派提示词内容' }, { id: 'g2', label: '另一流派', badge: '', desc: '', prompt: '另一流派内容' }], depths: [{ id: 'd1', label: '浅层', badge: '', desc: '', prompt: '浅层深度内容' }], selectedGenreId: 'g1', selectedDepthId: 'd1', createdAt: 1, updatedAt: 1 };
        h7.api.syncCustomEventTypes({ customTemplates: [tpl] });
        const typeObj = h7.api.EVENT_TYPES['ct_test2'];
        assert(typeObj, 'custom type not registered');
        assert.equal(typeObj.prefix, 'f');
        assert.equal(typeObj.label, '校园试炼');
        const s7 = { ...h7.api.DEFAULT_SETTINGS, customTemplates: [tpl] };
        const msgs = h7.api.buildEventPrompt(typeObj, '玩家: 你好', s7, []);
        const text = msgs.map(m => m.content).join('\n');
        assert(text.includes('自定义主提示词内容'), 'main prompt not injected');
        assert(text.includes('流派提示词内容'), 'selected genre prompt not injected');
        assert(!text.includes('另一流派内容'), 'unselected genre prompt leaked');
        assert(text.includes('浅层深度内容'), 'selected depth prompt not injected');
        assert(text.includes('【专属细分流派与难度设定'), 'sub prompt header missing');
        assert(text.includes('总计 3 回合'), 'custom turns not honored');
        // 未选择深度（空）时该节应回退到第一条；深度为空数组时整节省略
        const noDepth = { ...tpl, depths: [], selectedDepthId: '' };
        const msgs2 = h7.api.buildEventPrompt(typeObj, '玩家: 你好', { ...h7.api.DEFAULT_SETTINGS, customTemplates: [noDepth] }, []);
        const text2 = msgs2.map(m => m.content).join('\n');
        assert(text2.includes('流派提示词内容'), 'genre prompt missing without depth');
        assert(!text2.includes('浅层深度内容'), 'depth prompt leaked after removal');
        // 删除事件包后注册同步摘除
        h7.api.syncCustomEventTypes({ customTemplates: [] });
        assert(!h7.api.EVENT_TYPES['ct_test2'], 'deleted custom type still registered');
    });

    check('Custom template prefix allocation and persistence round trip',()=>{
        const h8 = harness();
        // 前缀分配：跳过已占用字母，池耗尽后回退 x2 序列
        assert.equal(h8.api.allocCustomPrefix([]), 'e');
        assert.equal(h8.api.allocCustomPrefix([{ prefix: 'e' }, { prefix: 'f' }]), 'g');
        const drained = ['e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z'].map(p => ({ prefix: p }));
        assert.equal(h8.api.allocCustomPrefix(drained), 'x2');
        // 持久化往返：写入设置后经 getSettings 合并取回，字段形状稳定
        const tpl = { id: 'ct_rt1', prefix: 'e', name: '往返测试', mainPrompt: '', turns: 5, genres: [{ id: 'g1', label: '流', badge: '流', desc: '', prompt: '内容' }], depths: [], selectedGenreId: 'g1', selectedDepthId: '', createdAt: 1, updatedAt: 1 };
        h8.api.persistSettings({ ...h8.api.getSettings(), customTemplates: [tpl] });
        const back = h8.api.getCustomTemplates(h8.api.getSettings());
        assert.equal(back.length, 1, 'custom template not persisted');
        assert.equal(back[0].id, 'ct_rt1');
        assert.equal(back[0].turns, 5);
        assert.equal(h8.api.isCustomTemplateComplete(back[0]), true, 'round-tripped template must stay complete');
        // collectSettingsForm 必须原样回带，避免保存全局设置时清空事件包
        const collected = h8.api.collectSettingsForm();
        assert(Array.isArray(collected.customTemplates) && collected.customTemplates.length === 1, 'collectSettingsForm drops customTemplates');
    });
    check('Prompt viewer covers custom templates and mirrors real sub settings',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        // 编辑器弹窗可缩放：RESIZE_PANEL_IDS 必须包含自定义事件包弹窗（及其后的导入/导出弹窗）
        assert(src.includes("'se-world-info-modal', 'se-variable-modal', 'se-custom-template-modal'"), 'resize list missing custom template modal');
        // 主类下拉渲染自定义事件包选项
        assert(src.includes("getCustomTemplates(s).map(t => `<option"), 'viewer type select missing custom template options');
        // 回合数从真实细节设置同步（打开/切换主类共用同一函数）
        assert(src.includes('function syncPromptViewerStateForType'), 'viewer state sync missing');
        const syncBody = src.slice(src.indexOf('function syncPromptViewerStateForType'), src.indexOf('function buildPromptViewerTempSettings'));
        assert(syncBody.includes('Number(t?.turns)') && syncBody.includes('Number(curSub.turns)'), 'turns not synced from sub settings / template');
        // 回合下拉四档（与细分设置一致）：1/2/3/多回合；多回合取 max(4, 当前值) 保证当前多回合设置零失真预览
        assert(src.includes('多回合 (连续大纲)') && src.includes('Math.max(4, promptViewerState.turns)'), 'four-tier turn options missing');
        assert(!src.includes('5 回合 (连续大纲)') && !src.includes('回合（当前设置）'), 'legacy 1-6 turn options should be removed');
        // 预览与「复制全部文本/JSON」共用同一镜像设置（1 处渲染 + 2 处复制）
        assert(src.includes('function buildPromptViewerTempSettings'), 'shared mirror settings helper missing');
        assert((src.match(/buildPromptViewerTempSettings\(s\)/g) || []).length >= 3, 'copy handlers not using shared mirror settings');
        // 死亡危险开关与只读锁定徽标
        assert(src.includes('data-pv-action="toggle-death"'), 'death toggle missing');
        assert(src.includes('已锁对手：') && src.includes('已锁女主：'), 'lock badges missing');
        // 示例范例：不再包含填空说明文案
        assert(!src.includes('复制后逐项改写') && !src.includes('用两三句写明'), 'genre template still placeholder-style');
        assert(!src.includes('（深度提示词模板'), 'depth template still placeholder-style');
        // 行为：自定义事件包 20 回合经 buildEventPrompt 输出「总计 20 回合」
        const h9 = harness();
        const tpl20 = { id: 'ct_t20', prefix: 'e', name: '长线模板', mainPrompt: '', turns: 20, genres: [{ id: 'g1', label: '长线', badge: '', desc: '', prompt: '长线流派内容' }], depths: [], selectedGenreId: 'g1', selectedDepthId: '', createdAt: 1, updatedAt: 1 };
        const type20 = { key: 'ct_t20', prefix: 'e', label: '长线模板', title: '长线模板' };
        const msgs20 = h9.api.buildEventPrompt(type20, '玩家: 你好', { ...h9.api.DEFAULT_SETTINGS, customTemplates: [tpl20] }, []);
        assert(msgs20.some(m => String(m.content).includes('总计 20 回合')), 'custom 20 turns not honored in prompt');
        assert(msgs20.some(m => String(m.content).includes('长线流派内容')), 'genre prompt missing at 20 turns');
    });
    check('Custom template extras are multi-select and presets workshop covers customs',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        // 数据模型与完成度
        assert(src.includes('extras: arr(src.extras)') && src.includes('selectedExtraIds: Array.isArray(src.selectedExtraIds)'), 'extras model missing in normalize');
        assert(src.includes('if (!extras.every(isCustomTemplateItemValid)) return false;'), 'completeness ignores extras');
        assert(src.includes('DEFAULT_CUSTOM_EXTRA_PROMPT'), 'extra example constant missing');
        // 生成链路
        assert(src.includes('`extra_${ex.id}`'), 'extra subPrompt override key missing');
        assert(src.includes('selExtraIds.includes(ex.id)'), 'extras injection not gated on selection');
        // 编辑器
        assert(src.includes('ct-add-extra') && src.includes('ct-del-extra') && src.includes('se-ct-extra-check'), 'editor extra section missing');
        // 查看器
        assert(src.includes('extraKeys: []') && src.includes("pvAction === 'toggle-extra'"), 'viewer extra multi-select missing');
        // 预设工坊：自定义事件包组 + 主提示词同源写回
        assert(src.includes('const customPresetsHtml = getCustomTemplates(s).map') && src.includes('data-ct-main-prompt'), 'presets workshop custom groups missing');
        assert(src.includes("textarea.dataset.ctMainPrompt") && src.includes('mainPrompt: String(textarea.value'), 'presets workshop main prompt source missing');
        // 行为：多选注入、工坊覆盖层、完成后门判定
        const hx = harness();
        const tplX = { id: 'ct_x1', prefix: 'e', name: '额外模板', mainPrompt: '', turns: 2, genres: [{ id: 'g1', label: '流', badge: '', desc: '', prompt: '流派内容' }], depths: [], extras: [{ id: 'x1', label: '死亡危险', badge: '', desc: '', prompt: '高危死线规则' }, { id: 'x2', label: '恋爱目标', badge: '', desc: '', prompt: '目标锁定规则' }], selectedGenreId: 'g1', selectedDepthId: '', selectedExtraIds: ['x1'], createdAt: 1, updatedAt: 1 };
        const typeX = { key: 'ct_x1', prefix: 'e', label: '额外模板', title: '额外模板' };
        const baseS = { ...hx.api.DEFAULT_SETTINGS, customTemplates: [tplX] };
        const textX = hx.api.buildEventPrompt(typeX, '玩家: x', baseS, []).map(m => m.content).join('\n');
        assert(textX.includes('高危死线规则'), 'selected extra not injected');
        assert(!textX.includes('目标锁定规则'), 'unselected extra leaked');
        const both = hx.api.buildEventPrompt(typeX, 'x', { ...baseS, customTemplates: [{ ...tplX, selectedExtraIds: ['x1', 'x2'] }] }, []).map(m => m.content).join('\n');
        assert(both.includes('高危死线规则') && both.includes('目标锁定规则'), 'multi-select extras not both injected');
        assert(both.indexOf('高危死线规则') < both.indexOf('目标锁定规则'), 'extras order not preserved');
        // 工坊覆盖层：subPrompts["ct_x1.extra_x1"] 优先于条目值
        const over = hx.api.buildEventPrompt(typeX, 'x', { ...baseS, subPrompts: { 'ct_x1.extra_x1': '覆盖版死线' } }, []).map(m => m.content).join('\n');
        assert(over.includes('覆盖版死线') && !over.includes('高危死线规则'), 'workshop override not honored for extras');
        // 完成度：额外半填不通过 / 悬空勾选不通过
        const baseC = { id: 'ct_xt', prefix: 'e', name: 'n', mainPrompt: '', turns: 2, genres: [{ id: 'g', label: 'g', badge: '', desc: '', prompt: 'p' }], depths: [], selectedGenreId: 'g', selectedDepthId: '', createdAt: 1, updatedAt: 1 };
        assert.equal(hx.api.isCustomTemplateComplete(baseC), true, 'base must be complete');
        assert.equal(hx.api.isCustomTemplateComplete({ ...baseC, extras: [{ id: 'e1', label: '死亡危险', badge: '', desc: '', prompt: '' }] }), false, 'half-filled extra must fail');
        const validExtra = { id: 'e1', label: '死亡危险', badge: '', desc: '', prompt: '规则' };
        assert.equal(hx.api.isCustomTemplateComplete({ ...baseC, extras: [validExtra], selectedExtraIds: ['e1'] }), true, 'valid selected extra must pass');
        assert.equal(hx.api.isCustomTemplateComplete({ ...baseC, extras: [validExtra], selectedExtraIds: ['nope'] }), false, 'dangling extra selection must fail');
    });
    check('Model request actions persist the form before requesting',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        // load-models / test-llm 必须先保存当前表单再发起请求：用户不点「保存设置」直接请求时改动不应丢失
        const loadModelsStart = src.indexOf("if (action === 'load-models')");
        const loadModelsBlock = src.slice(loadModelsStart, src.indexOf("if (action === 'test-llm')", loadModelsStart));
        assert(loadModelsBlock.includes('persistSettings(form)'), 'load-models does not persist before requesting');
        assert(loadModelsBlock.indexOf('persistSettings(form)') < loadModelsBlock.indexOf('loadModelList(form)'), 'load-models requests before persisting');
        const testLlmBlock = src.slice(src.indexOf("if (action === 'test-llm')"), src.indexOf("if (action === 'reset-fab')"));
        assert(testLlmBlock.includes('persistSettings(form)'), 'test-llm does not persist before requesting');
        assert(testLlmBlock.indexOf('persistSettings(form)') < testLlmBlock.indexOf('testLLMConnection(form)'), 'test-llm requests before persisting');
    });
    check('Idle engine card hides prompt viewer but workshop entry remains',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        // 场景进度空闲态（mountUI 静态模板 + updateEnginePanelCard 空闲分支）不再显示「提示词查看」按钮
        assert(!src.includes('data-action="open-prompt-viewer" style="margin-left:6px;'), 'idle engine card still renders prompt viewer button');
        // 预设工坊查看器入口必须保留（功能仍可访问）
        assert(src.includes('class="se-presets-viewer-entry"') && src.includes('data-action="open-prompt-viewer" style="width:100%'), 'workshop prompt viewer entry missing');
    });
    check('Extra template entry labels are short and grid bottom-aligned',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
        // 额外条目名称标签不再内联长示例（换行导致输入框错位），示例改放 placeholder
        assert(!src.includes('名称（必填，如：死亡危险 / 敌方势力 / 恋爱目标）'), 'extra name label still carries long inline examples');
        assert(src.includes('class="se-ct-field-label">名称（必填）'), 'extra name label not shortened');
        assert(src.includes('placeholder="例如：死亡危险 / 敌方势力 / 恋爱目标"'), 'extra examples not moved to placeholder');
        // 网格两格底部对齐：某格标签换行时输入框仍同一水平线
        const gridBlock = css.slice(css.indexOf('.se-ct-item-grid {'), css.indexOf('}', css.indexOf('.se-ct-item-grid {')));
        assert(gridBlock.includes('align-items: end'), 'item grid missing bottom alignment');
    });
    check('Custom template export payload carries normalized bodies only',()=>{
        const he = harness();
        const tpl = { id: 'ct_ex1', prefix: 'e', name: '导出模板', mainPrompt: '主提示词', turns: 3, genres: [{ id: 'g1', label: '流', badge: '', desc: '', prompt: '流派内容' }], depths: [{ id: 'd1', label: '深', desc: '', prompt: '深度内容' }], extras: [], selectedGenreId: 'g1', selectedDepthId: 'd1', selectedExtraIds: [], createdAt: 1, updatedAt: 2 };
        // v9 起本体是唯一事实源：即使存档里残留覆盖键，导出也只带 templates（覆盖在导入侧折叠）
        const s = { ...he.api.DEFAULT_SETTINGS, customTemplates: [tpl], presets: { ct_ex1: { systemPrompt: '残留主覆盖' } }, subPrompts: { 'ct_ex1.g1': '残留流派覆盖' } };
        const p = he.api.buildCustomTemplateExportPayload([tpl], s);
        assert.equal(p.plugin, 'st-direct-event');
        assert.equal(p.kind, 'st-direct-event-custom-templates');
        assert.equal(p.version, 1);
        assert.equal(p.templates.length, 1);
        assert.equal(p.templates[0].name, '导出模板');
        assert.equal(p.templates[0].mainPrompt, '主提示词');
        assert(!('presets' in p) && !('subPrompts' in p), 'export must not carry override layers');
        // 多余的 settings 实参兼容旧调用（签名改为单参也不报错）
        const p2 = he.api.buildCustomTemplateExportPayload([tpl]);
        assert(!('presets' in p2) && !('subPrompts' in p2), 'export must not carry override layers');
        // 缺字段事件包导出后形状稳定（normalize 兜底）
        const p3 = he.api.buildCustomTemplateExportPayload([{ name: '裸', genres: [{ id: 'g9', label: 'g', prompt: 'p' }], selectedGenreId: 'g9' }]);
        assert.equal(p3.templates[0].turns, 2);
        assert.equal(p3.templates[0].depths.length, 0);
        assert.equal(p3.templates[0].selectedGenreId, 'g9');
    });
    check('Custom template import parses wrapped, bare and single forms',()=>{
        const hi = harness();
        const tpl = { id: 'ct_im1', prefix: 'k', name: '导入模板', mainPrompt: '', turns: 2, genres: [{ id: 'g1', label: '流', badge: '', desc: '', prompt: '流派内容' }], depths: [], extras: [], selectedGenreId: 'g1', selectedDepthId: '', selectedExtraIds: [], createdAt: 1, updatedAt: 1 };
        const wrapped = JSON.stringify({ plugin: 'st-direct-event', kind: 'st-direct-event-custom-templates', version: 1, templates: [tpl] });
        const s0 = { ...hi.api.DEFAULT_SETTINGS, customTemplates: [] };
        // 三种形态：完整导出包装 / 裸数组 / 单模板对象；无冲突时 id 与前缀原样保留
        for (const text of [wrapped, JSON.stringify([tpl]), JSON.stringify(tpl)]) {
            const r = hi.api.parseCustomTemplateImportPayload(text, s0);
            assert.equal(r.ok, true, 'form should parse: ' + text.slice(0, 30));
            assert.equal(r.templates.length, 1);
            assert.equal(r.templates[0].id, 'ct_im1', 'conflict-free id must be preserved');
            assert.equal(r.templates[0].prefix, 'k', 'conflict-free prefix must be preserved');
            assert.equal(r.templates[0].turns, 2);
        }
        // 非法 JSON / 无模板数据 / 纯空数组
        assert.equal(hi.api.parseCustomTemplateImportPayload('not json{', s0).ok, false);
        assert.equal(hi.api.parseCustomTemplateImportPayload(JSON.stringify({ foo: 1 }), s0).ok, false);
        assert.equal(hi.api.parseCustomTemplateImportPayload('[]', s0).ok, false);
        // 空壳条目跳过并提示
        const rSkip = hi.api.parseCustomTemplateImportPayload(JSON.stringify({ templates: [tpl, { name: '', mainPrompt: '', genres: [], depths: [], extras: [] }] }), s0);
        assert.equal(rSkip.templates.length, 1);
        assert(rSkip.warnings.some(w => w.includes('空事件包')), 'skipped-empty warning missing');
    });
    check('Custom template import reallocates conflicting ids and prefixes',()=>{
        const hc = harness();
        const tpl = { id: 'ct_dup1', prefix: 'e', name: '重复模板', mainPrompt: '', turns: 2, genres: [{ id: 'g1', label: '流', badge: '', desc: '', prompt: '流派内容' }], depths: [], extras: [], selectedGenreId: 'g1', selectedDepthId: '', selectedExtraIds: [], createdAt: 1, updatedAt: 1 };
        const sDup = { ...hc.api.DEFAULT_SETTINGS, customTemplates: [{ ...tpl }] };
        const r1 = hc.api.parseCustomTemplateImportPayload(JSON.stringify({ templates: [tpl] }), sDup);
        assert.equal(r1.ok, true);
        assert.notEqual(r1.templates[0].id, 'ct_dup1', 'conflicting id must be reallocated');
        assert.notEqual(r1.templates[0].prefix, 'e', 'conflicting prefix must be reallocated');
        assert.equal(hc.api.isCustomTemplateComplete(r1.templates[0]), true, 'reallocation must not break completeness');
        // 同一文件两次导入得到不同 id 与不同前缀
        const sAfter = { ...hc.api.DEFAULT_SETTINGS, customTemplates: sDup.customTemplates.concat(r1.templates) };
        const r2 = hc.api.parseCustomTemplateImportPayload(JSON.stringify({ templates: [tpl] }), sAfter);
        assert.notEqual(r2.templates[0].id, r1.templates[0].id, 'second import must get a distinct id');
        assert.notEqual(r2.templates[0].prefix, r1.templates[0].prefix, 'second import must get a distinct prefix');
        // 固定 a-d 前缀视为占用（防止与固定模板事件计数串号）
        const sFixed = { ...hc.api.DEFAULT_SETTINGS, customTemplates: [] };
        const rFixed = hc.api.parseCustomTemplateImportPayload(JSON.stringify({ templates: [{ ...tpl, id: 'ct_f1', prefix: 'a' }] }), sFixed);
        assert.equal(rFixed.templates[0].id, 'ct_f1', 'conflict-free id must stay');
        assert.notEqual(rFixed.templates[0].prefix, 'a', 'fixed a-d prefixes must be treated as taken');
        assert(!['a', 'b', 'c', 'd'].includes(rFixed.templates[0].prefix), 'reallocated prefix must avoid a-d');
        // 合法空闲前缀原样保留
        const rKeep = hc.api.parseCustomTemplateImportPayload(JSON.stringify({ templates: [{ ...tpl, id: 'ct_k1', prefix: 'm' }] }), sFixed);
        assert.equal(rKeep.templates[0].prefix, 'm', 'free prefix must be kept');
    });
    check('Custom template import remaps override keys and reports drafts and name clashes',()=>{
        const hw = harness();
        const tpl = { id: 'ct_ov1', prefix: 'e', name: '覆盖模板', mainPrompt: '', turns: 2, genres: [{ id: 'g1', label: '流', badge: '', desc: '', prompt: '流派内容' }], depths: [], extras: [], selectedGenreId: 'g1', selectedDepthId: '', selectedExtraIds: [], createdAt: 1, updatedAt: 1 };
        const sW = { ...hw.api.DEFAULT_SETTINGS, customTemplates: [{ ...tpl }], presets: { ct_ov1: { systemPrompt: '接收者自己的覆盖' } } };
        const payload = { templates: [tpl], presets: { ct_ov1: { systemPrompt: '分享者的覆盖' } }, subPrompts: { 'ct_ov1.g1': '分享者的流派覆盖', 'ct_absent.g1': '无主覆盖' } };
        const r = hw.api.parseCustomTemplateImportPayload(JSON.stringify(payload), sW);
        assert.equal(r.ok, true);
        const newId = r.templates[0].id;
        assert.notEqual(newId, 'ct_ov1', 'same id must be reallocated');
        assert.equal(r.presets[newId]?.systemPrompt, '分享者的覆盖', 'preset override must follow the remapped id');
        assert.equal(r.subPrompts[newId + '.g1'], '分享者的流派覆盖', 'subPrompt override key must follow the remapped id');
        assert.equal(r.subPrompts['ct_absent.g1'], undefined, 'override keys without a matching template must be dropped');
        assert.equal(r.presets['ct_ov1'], undefined, 'old preset key must not survive remap');
        // 草稿警告保留；同名冲突改由 computeImportConflicts + 冲突弹窗逐条决策，parse 不再产同名 warning
        const draftTpl = { ...tpl, name: '覆盖模板', genres: [{ id: 'g1', label: '', badge: '', desc: '', prompt: '流派内容' }] };
        const rD = hw.api.parseCustomTemplateImportPayload(JSON.stringify({ templates: [draftTpl] }), sW);
        assert.equal(hw.api.isCustomTemplateComplete(rD.templates[0]), false, 'half-filled import must stay a draft');
        assert(rD.warnings.some(w => w.includes('草稿')), 'draft warning missing');
        assert(!rD.warnings.some(w => w.includes('同名')), 'name clash is resolved via conflict dialog, no warning');
        // 冲突计算：本地同名 → existingId 指向现有模板；批内重名（本地无同名）→ existingId 空串且仅第二个起算冲突
        const tplB = { ...tpl, id: 'ct_b1', prefix: 'f', name: '批次重名' };
        const tplB2 = { ...tpl, id: 'ct_b2', prefix: 'g', name: '批次重名' };
        const rB = hw.api.parseCustomTemplateImportPayload(JSON.stringify({ templates: [tplB, tplB2] }), { ...hw.api.DEFAULT_SETTINGS, customTemplates: [] });
        const conflictsB = hw.api.computeImportConflicts(rB, { ...hw.api.DEFAULT_SETTINGS, customTemplates: [] });
        assert.equal(conflictsB.length, 1, 'batch-internal duplicate must conflict from the second occurrence');
        assert.equal(conflictsB[0].index, 1, 'first occurrence keeps the name without asking');
        assert.equal(conflictsB[0].existingId, '', 'batch-internal duplicate has no local overwrite target');
        const rC = hw.api.parseCustomTemplateImportPayload(JSON.stringify({ templates: [tpl] }), sW);
        const conflictsC = hw.api.computeImportConflicts(rC, sW);
        assert.equal(conflictsC.length, 1, 'local same-name must be detected as conflict');
        assert.equal(conflictsC[0].existingId, 'ct_ov1', 'conflict must point at the local template id');
        assert.equal(hw.api.computeImportConflicts({ ok: false }, sW).length, 0, 'invalid parse result has no conflicts');
    });
    check('Template import/export UI is wired end to end',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
        // 主面板导入入口（无行内导出按钮：导出统一收敛进弹窗勾选式）
        assert(src.includes('data-action="open-template-io"'), 'panel import entry missing');
        assert(!src.includes('data-action="export-custom" data-template='), 'inline export button should be removed');
        assert(!src.includes("if (action === 'export-custom')"), 'inline export dispatcher branch should be removed');
        assert(!src.includes('seExportBound'), 'inline export contextmenu binding should be removed');
        // 弹窗、粘贴框与文件选择
        assert(src.includes('id="se-template-io-modal"') && src.includes('id="se-tio-import-text"'), 'io modal missing');
        assert(src.includes('id="se-tio-file-input"') && src.includes('accept=".json,application/json"'), 'file input missing');
        assert(src.includes("e.target.id === 'se-tio-file-input'"), 'file input change not wired');
        // 勾选式导出：列表容器 / 复选框 / 全选切换 / 默认全不选
        assert(src.includes('id="se-tio-export-list"') && src.includes('class="se-tio-export-check"'), 'export selection list missing');
        assert(src.includes('templateExportSel = new Set()') && src.includes('templateExportSel.clear()'), 'export selection set reset missing');
        assert(src.includes('data-action="tio-export-toggle-all"') && src.includes('function toggleTemplateExportAll'), 'select-all toggle missing');
        assert(src.includes("e.target.closest('.se-tio-export-check')"), 'export checkbox change delegate missing');
        // 分发器分支齐全（按勾选导出，无 export-all-*；含同名冲突弹窗分支）
        for (const act of ['open-template-io','close-template-io','pick-template-file','import-custom-submit','export-selected-file','export-selected-copy','tio-export-toggle-all','conflict-confirm','conflict-cancel']) {
            assert(src.includes(`if (action === '${act}')`), 'dispatcher branch missing: ' + act);
        }
        assert(!src.includes("if (action === 'export-all-file')") && !src.includes("if (action === 'export-all-copy')"), 'legacy export-all branches should be removed');
        // 下载实现与 objectURL 释放
        assert(src.includes('new Blob([') && src.includes('URL.createObjectURL') && src.includes('URL.revokeObjectURL'), 'file download implementation missing');
        // 新弹窗进 RESIZE 列表获得缩放把手与尺寸记忆（冲突弹窗追加在尾部）
        assert(src.includes("'se-custom-template-modal', 'se-template-io-modal'"), 'io modal not in RESIZE_PANEL_IDS');
        assert(src.includes("'se-template-io-modal', 'se-conflict-modal']"), 'conflict modal not in RESIZE_PANEL_IDS');
        // 新建/导入行等宽各半 + 新建按钮虚线透明融入背景板（组容器去卡片底）
        assert(src.includes('se-btn-group se-add-row'), 'add row group class missing');
        assert(css.includes('.se-btn-group.se-add-row') && css.includes('#st-direct-event-root .se-add-row > button'), 'equal-width add row css missing');
        const addRowBlock = css.slice(css.indexOf('.se-btn-group.se-add-row {'), css.indexOf('}', css.indexOf('.se-btn-group.se-add-row {')));
        assert(addRowBlock.includes('background: transparent') && addRowBlock.includes('border: 0') && addRowBlock.includes('box-shadow: none') && addRowBlock.includes('gap: 8px'), 'add row container must be transparent to reveal panel background');
        assert(css.includes('#st-direct-event-root .se-add-row .se-event-btn.se-custom-add-btn') && css.includes('1.5px dashed'), 'add button dashed style missing');
        assert(css.includes('#st-direct-event-root .se-tio-export-list') && css.includes('#st-direct-event-root .se-tio-export-check'), 'export list css missing');
        // 前缀占用集合必须包含固定 a-d（防串号关键）
        assert(src.includes("new Set(['a', 'b', 'c', 'd'])"), 'fixed prefixes must be treated as taken on import');
        // 行为端到端：parse → apply → 注册进 EVENT_TYPES
        const hz = harness();
        hz.api.persistSettings({ ...hz.api.getSettings(), customTemplates: [] });
        const tplZ = { id: 'ct_e2e', prefix: 'e', name: '端到端', mainPrompt: '', turns: 2, genres: [{ id: 'g1', label: '流', badge: '', desc: '', prompt: '流派内容' }], depths: [], extras: [], selectedGenreId: 'g1', selectedDepthId: '', selectedExtraIds: [], createdAt: 1, updatedAt: 1 };
        const rZ = hz.api.parseCustomTemplateImportPayload(JSON.stringify({ templates: [tplZ] }), hz.api.getSettings());
        assert.equal(rZ.ok, true);
        assert.equal(hz.api.applyCustomTemplateImport(rZ), true, 'apply failed');
        const after = hz.api.getCustomTemplates(hz.api.getSettings());
        assert.equal(after.length, 1, 'imported template not persisted');
        assert.equal(after[0].name, '端到端');
        assert(hz.api.EVENT_TYPES['ct_e2e'], 'imported template not registered into EVENT_TYPES');
        // 无效结果不写入
        assert.equal(hz.api.applyCustomTemplateImport({ ok: false }), false);
        assert.equal(hz.api.getCustomTemplates(hz.api.getSettings()).length, 1, 'failed apply must not mutate');
        // 勾选式导出：未勾选警告返回 null；按勾选过滤 payload；未勾选事件包不泄漏
        const tplZ2 = { ...tplZ, id: 'ct_e2e2', prefix: 'f', name: '端到端2' };
        hz.api.persistSettings({ ...hz.api.getSettings(), customTemplates: [tplZ, tplZ2] });
        assert.equal(hz.api.exportCustomTemplatesByIds([], 'file'), null, 'empty selection must warn and return null');
        const picked = hz.api.exportCustomTemplatesByIds(['ct_e2e2'], 'file');
        assert(picked && Array.isArray(picked.templates) && picked.templates.length === 1, 'selected-only export failed');
        assert.equal(picked.templates[0].id, 'ct_e2e2', 'unselected template leaked into export payload');
    });
    check('Import dispositions: overwrite takes over id and prefix, skip drops, new auto-renames',()=>{
        const hd = harness();
        hd.api.persistSettings({ ...hd.api.DEFAULT_SETTINGS, customTemplates: [] });
        const mkTpl = (id, prefix, name, genrePrompt) => ({ id, prefix, name, mainPrompt: '', turns: 2, genres: [{ id: 'g1', label: '流', badge: '', desc: '', prompt: genrePrompt }], depths: [], extras: [], selectedGenreId: 'g1', selectedDepthId: '', selectedExtraIds: [], createdAt: 1, updatedAt: 1 });
        // 本地已有「悬疑」（事件编号前缀 b）；导入批次含三个同名「悬疑」+ 一个无冲突「日常」
        hd.api.persistSettings({ ...hd.api.getSettings(), customTemplates: [mkTpl('ct_local', 'b', '悬疑', '本地流派')] });
        const payload = { templates: [mkTpl('ct_new', 'e', '悬疑', '覆盖来源'), mkTpl('ct_dup', 'f', '悬疑', '新增来源'), mkTpl('ct_dup2', 'g', '悬疑', '取消来源'), mkTpl('ct_daily', 'h', '日常', '日常流派')], presets: { ct_new: { systemPrompt: '分享者主覆盖' } }, subPrompts: { 'ct_dup.g1': '分享者流派覆盖' } };
        const r = hd.api.parseCustomTemplateImportPayload(JSON.stringify(payload), hd.api.getSettings());
        assert.equal(r.ok, true);
        const conflicts = hd.api.computeImportConflicts(r, hd.api.getSettings());
        assert.equal(conflicts.length, 3, 'three same-name templates must conflict');
        // 处置：0=覆盖（接手 ct_local 的 id/前缀）、1=新增（自动编号）、2=取消导入；「日常」不在名单直接导入
        const dispositions = { 0: 'overwrite', 1: 'new', 2: 'skip' };
        assert.equal(hd.api.applyCustomTemplateImport(r, dispositions), true, 'apply with dispositions failed');
        const after = hd.api.getCustomTemplates(hd.api.getSettings());
        const names = after.map(t => t.name);
        assert.equal(after.length, 3, 'skip must drop its template; overwrite must not add');
        // 覆盖：接手被覆盖者的 id 与事件计数前缀（历史事件编号、短编号触发不断链），且分享者覆盖键折叠进本体
        const over = after.find(t => t.id === 'ct_local');
        assert(over, 'overwrite must keep the local template id');
        assert.equal(over.prefix, 'b', 'overwrite must take over the local prefix');
        assert.equal(over.genres[0].prompt, '覆盖来源', 'overwrite body must come from the import');
        assert.equal(over.mainPrompt, '分享者主覆盖', 'old-format payload preset override must fold into the imported body');
        // 新增：自动编号避免与本地现有名冲突；旧格式 payload 的流派覆盖折叠进本体
        const added = after.find(t => t.name === '悬疑1');
        assert(added, 'conflicting new template must be auto-renamed 悬疑1');
        assert.notEqual(added.id, 'ct_local', 'added template must keep its own id');
        assert.equal(added.genres[0].prompt, '分享者流派覆盖', 'old-format payload subPrompt override must fold into the imported body');
        assert(!after.some(t => t.name === '悬疑2'), 'skipped template must not be imported');
        assert(names.includes('日常'), 'conflict-free template imports without asking');
        assert(!hd.api.getSettings().presets?.ct_local && !Object.keys(hd.api.getSettings().subPrompts || {}).some(k => k.startsWith('ct_local.') || k.startsWith(added.id + '.')), 'overrides must be folded into bodies, never stored');
        // 无处置参数（缺省全按新增）：同名自动编号、不覆盖
        const r2 = hd.api.parseCustomTemplateImportPayload(JSON.stringify({ templates: [mkTpl('ct_x', 'i', '悬疑', '再导入')] }), hd.api.getSettings());
        assert.equal(hd.api.applyCustomTemplateImport(r2), true, 'default-disposition apply failed');
        const after2 = hd.api.getCustomTemplates(hd.api.getSettings());
        assert(after2.some(t => t.name === '悬疑2'), 'default disposition auto-renames instead of overwriting');
        assert.equal(after2.filter(t => t.id === 'ct_local').length, 1, 'default disposition must not overwrite local template');
        // 全部取消 → 不写入
        const r3 = hd.api.parseCustomTemplateImportPayload(JSON.stringify({ templates: [mkTpl('ct_y', 'j', '全新', '全新流派')] }), hd.api.getSettings());
        const before3 = JSON.stringify(hd.api.getCustomTemplates(hd.api.getSettings()));
        assert.equal(hd.api.applyCustomTemplateImport(r3, { 0: 'skip' }), false, 'all-skip apply must be a no-op');
        assert.equal(JSON.stringify(hd.api.getCustomTemplates(hd.api.getSettings())), before3, 'all-skip must not mutate');
    });
    check('Name conflict dialog and unified titles are wired',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
        // 冲突弹窗壳与行渲染、确认/取消、来源弹窗恢复
        assert(src.includes('id="se-conflict-modal"') && src.includes('id="se-conflict-body"'), 'conflict modal shell missing');
        assert(src.includes('function openConflictModal') && src.includes('function closeConflictModal') && src.includes('function handleConflictConfirm'), 'conflict modal functions missing');
        assert(src.includes("openConflictModal('import', { result, conflicts })"), 'import flow must route conflicts to the dialog');
        assert(src.includes('openConflictModal(\'editor\', { existingId: dup.id'), 'editor save must route name clashes to the dialog');
        assert(src.includes('applyCustomTemplateImport(ctx.result, dispositions)'), 'confirm must apply dispositions');
        assert(src.includes('returnModalId: source === \'import\' ? \'se-template-io-modal\' : \'se-custom-template-modal\''), 'conflict dialog must remember its source modal');
        assert(css.includes('#st-direct-event-root .se-conflict-row'), 'conflict row css missing');
        // 覆盖语义复用：删除与「覆盖同名」共用同一清理函数（对称清覆盖键）
        assert(src.includes('function removeCustomTemplateRecord') && src.includes('removeCustomTemplateRecord(s, ctx.existingId)'), 'overwrite must reuse the shared removal helper');
        // 导入提示文案不再宣称导出携带覆盖层
        assert(!src.includes('含预设工坊里改过的提示词覆盖'), 'io modal tip must reflect body-only export');
        // 编辑器标题：编辑态「事件包：X」、新建态「新建事件包」；行内 tooltip 同步
        assert(src.includes('`事件包：${t.name || \'未命名\'}`'), 'editor title should be 事件包：X');
        assert(src.includes("'新建事件包'"), 'new-pack editor title should be 新建事件包');
        assert(!src.includes('编辑自定义模板：'), 'old editor title should be gone');
        assert(src.includes('title="编辑自定义事件包"'), 'row pencil tooltip should be 编辑自定义事件包');
        // 工坊手风琴摘要直接用事件包名（不再冠「自定义模板预设：」前缀）
        assert(src.includes('<summary class="se-preset-accordion-summary">${escapeHtml(t.name || \'未命名事件包\')}</summary>'), 'workshop summary should be the bare pack name');
        assert(!src.includes('自定义模板预设：'), 'old workshop summary prefix should be gone');
        // 工坊自定义组与编辑器同源：data-ct-entry-key 直写条目本体，savePresets 对应收集
        assert(src.includes('data-ct-entry-key="${escapeHtml(t.id)}.${escapeHtml(g.id)}"'), 'workshop genre card must bind ct entry key');
        assert(src.includes('data-ct-entry-key="${escapeHtml(t.id)}.diff_${escapeHtml(d.id)}"'), 'workshop depth card must bind ct entry key');
        assert(src.includes('data-ct-entry-key="${escapeHtml(t.id)}.extra_${escapeHtml(e.id)}"'), 'workshop extra card must bind ct entry key');
        const savePresets = src.slice(src.indexOf('function savePresets'), src.indexOf('function resetPresets'));
        assert(savePresets.includes("textarea[data-ct-entry-key]") && savePresets.includes('entry.prompt = String(textarea.value'), 'savePresets must write ct entries back to the body');
        assert(savePresets.includes('if (presets[tid]) delete presets[tid];'), 'savePresets must drop stale main-prompt override keys');
        // 主提示词取值不再读覆盖层
        const presetFn = src.slice(src.indexOf('function customTemplatePreset'), src.indexOf('function syncCustomEventTypes'));
        assert(!presetFn.includes('settings?.presets?.[t?.id]'), 'customTemplatePreset must not read the retired override layer');
    });
    check('Import submit button lives inside the import collapsible section',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const tioStart = src.indexOf('id="se-template-io-modal"');
        const importKey = src.indexOf('data-section-key="tio-import"');
        const exportKey = src.indexOf('data-section-key="tio-export"');
        const submitBtn = src.indexOf('data-action="import-custom-submit"');
        assert(tioStart > -1 && importKey > tioStart && exportKey > importKey, 'io modal sections missing');
        assert(submitBtn > importKey && submitBtn < exportKey, 'import submit button must be inside the tio-import section');
        const tioBlock = src.slice(tioStart, src.indexOf('id="se-conflict-modal"'));
        assert(!tioBlock.includes('se-settings-actions'), 'io modal must no longer carry a footer action bar');
        assert(src.includes('点击「导入事件包」完成导入') && !src.includes('点击下方「导入事件包」完成导入'), 'file-read toast must drop the stale 下方 wording');
    });
    check('Import submit matches export action style; conflict footer drops duplicate cancel',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
        // 导入提交按钮与导出区两枚按钮同款 se-btn-action（通栏撑满+文字居中由 .se-tio-row .se-btn-action 的 flex:1 提供）
        assert(src.includes('data-action="import-custom-submit" class="se-btn-action"'), 'import submit must use se-btn-action');
        assert(!src.includes('class="se-sub-save-btn">导入事件包'), 'stale primary-style import button must be gone');
        // 冲突弹窗取消语义由头部按钮 + 逐行「取消导入/返回编辑改名」承担，页脚只留主操作（对齐编辑器弹窗页脚惯例）
        assert((src.match(/data-action="conflict-cancel"/g) || []).length === 1, 'conflict-cancel must exist only once (modal header)');
        assert(src.includes('<button data-action="conflict-cancel">取消</button>'), 'conflict header cancel missing');
        assert(src.includes('id="se-conflict-confirm-btn"'), 'conflict confirm button missing');
        assert(!src.includes('se-conflict-cancel-btn') && !css.includes('.se-conflict-cancel-btn'), 'footer duplicate cancel (markup+css) must be gone');
    });
    check('Workshop custom cards use plain names with desc lines and right-side tag badges',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
        // 三卡标题去掉「流派：/深度：/额外：」前缀与括号备注，回落名同步换新词
        assert(!src.includes('流派：${escapeHtml') && !src.includes('深度：${escapeHtml') && !src.includes('额外：${escapeHtml'), 'card title prefixes must be gone');
        assert(!src.includes('未命名流派') && !src.includes('未命名深度'), 'stale fallback names must be gone');
        // 四处「同源」说明行删除（含主提示词卡与附加卡的勾选提示）
        assert(!src.includes('与事件包编辑器中的'), 'same-source note lines must be removed');
        assert(!src.includes('该条仅在事件包编辑器中勾选后随生成注入'), 'extra gating note must be removed');
        // badge 标签右置：自定义流派卡 + 内置流派卡（subCardHtml 查 SUB_CONFIGS badge）
        assert(src.includes('se-preset-title-with-tag'), 'tagged title class missing');
        assert(src.includes('se-preset-tag">${escapeHtml(g.badge)}'), 'custom genre badge tag missing');
        assert(src.includes('SUB_CONFIGS[pKey]?.genres?.find(g => g.key === cKey)?.badge'), 'built-in genre badge lookup missing');
        assert(src.includes('se-preset-tag">${escapeHtml(badge)}'), 'built-in badge tag render missing');
        // 深度/额外卡补条件备注行（与流派卡同构）
        const workshop = src.slice(src.indexOf('function renderPresets'), src.indexOf('function savePresets'));
        assert(workshop.includes("${d.desc ? `<div class=\"se-preset-desc\">${escapeHtml(d.desc)}</div>` : ''}"), 'depth card conditional desc missing');
        assert(workshop.includes("${e.desc ? `<div class=\"se-preset-desc\">${escapeHtml(e.desc)}</div>` : ''}"), 'extra card conditional desc missing');
        // CSS：标题行 flex 两端对齐、标签胶囊不收缩、名称 span 可收缩断词
        const titleTagBlock = css.slice(css.indexOf('.se-preset-title-with-tag {'), css.indexOf('}', css.indexOf('.se-preset-title-with-tag {')));
        assert(titleTagBlock.includes('display: flex') && titleTagBlock.includes('justify-content: space-between'), 'tagged title flex css missing');
        const tagBlock = css.slice(css.indexOf('.se-preset-tag {'), css.indexOf('}', css.indexOf('.se-preset-tag {')));
        assert(tagBlock.includes('flex-shrink: 0') && tagBlock.includes('white-space: nowrap') && tagBlock.includes('border-radius: 999px'), 'tag pill css missing');
        const nameBlock = css.slice(css.indexOf('.se-preset-name {'), css.indexOf('}', css.indexOf('.se-preset-name {')));
        assert(nameBlock.includes('min-width: 0') && nameBlock.includes('overflow-wrap: anywhere'), 'name span shrink css missing');
    });
    check('Custom pack terminology sweep: new terms replace old in UI copy only',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        // 新词在位：编辑器工具栏/空提示/卡片序号、复制范例 toast、缺项校验、工坊分组标题、冲突弹窗、查看器、主面板
        // （分区标题已改裸名、规则移入 se-presets-tip 提示框，由 'Editor section hints' 专门 check 覆盖）
        for (const s of ['添加风格','还没有风格，点击「添加风格」开始。','添加档位','还没有档位，不需要可不添加。','添加附加','还没有附加条目。','已复制风格提示词范例','已复制档位提示词范例','已复制附加提示词范例','至少一条风格','风格名称与提示词须填完整','默认风格选择','档位名称与提示词须填完整','默认档位选择','附加名称与提示词须填完整','风格预设（${genres.length} 条）','档位预设（${depths.length} 档）','附加预设（${extras.length} 条）','风格 ${index + 1}','档位 ${index + 1}','新建自定义事件包（风格、档位与提示词自由配置）','${genreCount} 风格 · ',"customTemplate ? '风格' : '流派'","customTemplate ? '档位' : '难度'",'se-pv-quick-label">附加:']) {
            assert(src.includes(s), 'terminology missing: ' + s);
        }
        // 旧词不得残留在自定义上下文（内置「小事件流派预设」、注释与 LLM 提示词正文不在此列）
        assert(!src.includes('流派预设（${genres.length}') && !src.includes('深度预设（${depths.length}') && !src.includes('额外预设（${extras.length}'), 'old workshop group titles should be gone');
        assert(!src.includes('添加流派') && !src.includes('添加深度') && !src.includes('添加额外'), 'old editor toolbar labels should be gone');
        assert(!src.includes('已复制流派提示词范例') && !src.includes('已复制深度提示词范例') && !src.includes('已复制额外提示词范例'), 'old copy-example toasts should be gone');
        assert(!src.includes('至少一条流派') && !src.includes('流派名称与提示词须填完整') && !src.includes('深度名称与提示词须填完整') && !src.includes('额外名称与提示词须填完整'), 'old validation toasts should be gone');
        assert(!src.includes('流派 / 风格（至少一条'), 'old editor section title should be gone');
        assert(!src.includes('流派 ${index + 1}') && !src.includes('深度 ${index + 1}') && !src.includes('>额外</span>'), 'old editor card index tags should be gone');
        assert(!src.includes('${genreCount} 流派') && !src.includes('se-pv-quick-label">额外:') && !src.includes('se-pv-quick-label">难度:') && !src.includes('新建自定义事件包（流派、深度'), 'old conflict/viewer/add-button wording should be gone');
        // LLM 提示词正文与注入头保持原样（生成注入与查看器检测串依赖）
        assert(src.includes('【专属细分流派与难度设定（'), 'injection header must stay untouched');
    });
    check('Editor section hints replace title parentheticals',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        // 三分区标题裸名，规则移入分区顶部 se-presets-tip 提示框（与编辑器顶部说明段同款样式，随分区折叠隐藏）
        assert(src.includes('<div class="se-presets-tip">至少一条，生成时单选其一。</div>'), 'genre section hint missing');
        assert(src.includes('<div class="se-presets-tip">可选，生成时单选其一，不添加则不注入档位设定。</div>'), 'depth section hint missing');
        assert(src.includes('<div class="se-presets-tip">可选，可多选，勾选的全部同时注入。</div>'), 'extra section hint missing');
        assert(!src.includes('风格（至少一条') && !src.includes('档位（可选') && !src.includes('附加（可选'), 'section title parentheticals must be gone');
        // 提示框须位于分区标题之后、工具栏调用之前（se-ct-section-toolbar class 字面量在 sectionToolbar
        // 函数定义里、位于模板之前，slice 内须用调用点定位）
        const genres = src.slice(src.indexOf('data-section-key="ct-genres"'), src.indexOf('data-section-key="ct-depths"'));
        const titlePos = genres.indexOf('se-settings-section-title');
        const hintPos = genres.indexOf('se-presets-tip');
        const toolbarPos = genres.indexOf("sectionToolbar('ct-copy-genre-template'");
        assert(titlePos > -1 && hintPos > titlePos && toolbarPos > hintPos, 'hint must sit between section title and toolbar');
    });
    check('Sub modal and settings titles drop meta parentheticals',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(!src.includes('展开可直接微调预设提示词'), 'genre section meta hint must be gone');
        assert(!src.includes('右键/长按可随时切换'), 'long-press meta hint must be gone');
        assert(src.includes('▾</span>选择流派 / 玩法风格</div>'), 'sub modal genre section title must stay');
        assert(src.includes('title.textContent = conf.title;'), 'sub modal title suffix must be gone');
        assert(!src.includes('势力库与自定义对手') && src.includes('▾</span>敌方势力与战力基准设定</div>'), 'faction section note must be gone, title kept');
        assert(!src.includes('支持卡片点击或下拉切换') && src.includes('>主题风格</label>'), 'theme usage hint must be gone, label kept');
        // 设置面板两个破限开关与工坊卡同名去括号（技术名信息由工坊卡 desc 行承载）
        assert(src.includes('启用全套缝合破限与创作约定') && !src.includes('启用全套缝合破限与创作约定（'), 'jailbreak toggle label must be plain');
        assert(src.includes('启用头部小说破限') && !src.includes('启用头部小说破限（'), 'novel bypass toggle label must be plain');
    });
    check('Workshop group titles and difficulty cards drop parenthetical remarks',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        // 组标题裸名（内容说明已由卡内 desc 行承载）；计数类括号保留（N 档 + 自定义 等）
        assert(src.includes("genreAccordion('combat', '战斗预设'"), 'combat group title must be plain');
        assert(src.includes("genreAccordion('reasoning', '推理预设'"), 'reasoning group title must be plain');
        assert(src.includes("genreAccordion('romance', '恋爱预设'"), 'romance group title must be plain');
        assert(src.includes('破限与防审查提示词</summary>') && src.includes('随机事件预设</summary>'), 'jailbreak/random group titles must be plain');
        assert(src.includes("subSection('presets-combat-death', '死亡危险死线提示词'"), 'death section title must be plain');
        assert(!src.includes('（大事件导演 / 小事件流派') && !src.includes('（极高死亡危险模式注入）') && !src.includes('（置顶注入与外审破限）') && !src.includes('随机事件预设（大事件导演）'), 'stale group title notes must be gone');
        // 两张破限卡标题裸名（「头部小说破限（」字样仍存在于代码注释，负向断言只针对括号备注内容串）
        assert(src.includes('<div class="se-preset-title">头部小说破限</div>'), 'novel bypass card title must be plain');
        assert(src.includes('<div class="se-preset-title">系统级破限与创作准则</div>'), 'jailbreak card title must be plain');
        assert(!src.includes('（雪融雪降 · 过外审预填充）') && !src.includes('（Dramatron 深度缝合版）'), 'stale card title notes must be gone');
        // 难度卡改「名称+小字」：普通档/自定义档标题裸名 se-preset-name，desc 移入条件小字行（depth/diff 共 3 处同构）
        const workshop = src.slice(src.indexOf('function renderPresets'), src.indexOf('function savePresets'));
        assert(workshop.includes('<div class="se-preset-title"><span class="se-preset-name">${escapeHtml(d.label)}</span></div>'), 'difficulty card title must be a plain name span');
        assert(workshop.includes("<span class=\"se-preset-name\">自定义${pKey === 'romance' ? '浓度' : '难度'}</span>"), 'custom difficulty card title must be a plain name span');
        const descLine = "${d.desc ? `<div class=\"se-preset-desc\">${escapeHtml(d.desc)}</div>` : ''}";
        assert(workshop.split(descLine).length - 1 >= 3, 'difficulty conditional desc lines missing');
        assert(!workshop.includes('双向同源'), 'stale same-source note must be gone');
        // 流派组不含 death_risk 冗余卡：它不是真流派（SUB_CONFIGS.combat.genres 无此项），且与独立死线小节
        // 同键 combat.death_risk，savePresets 按 DOM 序后者覆盖前者会静默吞掉流派组卡上的编辑
        assert(!workshop.includes("key: 'combat.death_risk'"), 'genre list must not carry the death_risk duplicate card');
        assert(workshop.includes('data-sub-prompt-key="combat.death_risk"'), 'dedicated death section card must stay');
    });
    check('Main panel three-tier layout and viewer cleanup',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
        // 查看器只留预览职责：两个保存按钮与其处理分支删除（全局小说破限保存保留）
        assert(!src.includes('保存为主类系统预设') && !src.includes("pvAction === 'save-to-preset'"), 'preset save button should be removed');
        assert(!src.includes('保存为流派与难度设定') && !src.includes("pvAction === 'save-sub-prompt'"), 'sub prompt save button should be removed');
        assert(src.includes('保存为全局小说破限') && src.includes("pvAction === 'save-global-novel'"), 'global novel save must stay');
        // 主面板三段式：上（场景进度）固定 / 中间 .se-panel-scroll 滚动 / 下（新建导入与导航）固定
        assert(src.includes('<div class="se-panel-scroll" id="se-panel-scroll">'), 'panel scroll wrapper missing');
        const scrollStart = src.indexOf('<div class="se-panel-scroll"');
        const customRowsAt = src.indexOf('<div id="se-custom-rows">');
        const scrollCloseAt = src.indexOf('<!-- /se-panel-scroll -->');
        const addRowAt = src.indexOf('se-btn-group se-add-row');
        assert(scrollStart > 0 && scrollStart < customRowsAt && customRowsAt < scrollCloseAt && scrollCloseAt < addRowAt, 'scroll wrapper must wrap event rows only (new/import row stays fixed below)');
        assert(css.includes('#st-direct-event-root .se-panel-scroll') && css.includes('overflow-y: auto'), 'panel scroll css missing');
        const contentRule = css.slice(css.indexOf('#st-direct-event-root .se-panel-content { padding: 14px'), css.indexOf('}', css.indexOf('#st-direct-event-root .se-panel-content { padding: 14px')));
        assert(contentRule.includes('overflow: hidden'), 'panel content must not scroll as a whole');
        // 新建/导入行：容器不裁切圆角，导入按钮对齐战斗卡片（边线+圆角+阴影）
        const addRowBlock = css.slice(css.indexOf('.se-btn-group.se-add-row {'), css.indexOf('}', css.indexOf('.se-btn-group.se-add-row {')));
        assert(addRowBlock.includes('overflow: visible'), 'add row container must not clip corner radius');
        const ioBtnBlock = css.slice(css.indexOf('#st-direct-event-root .se-add-row .se-sub-btn {'), css.indexOf('}', css.indexOf('#st-direct-event-root .se-add-row .se-sub-btn {')));
        assert(ioBtnBlock.includes('border-radius: var(--se-radius-md)') && ioBtnBlock.includes('1.5px dashed') && ioBtnBlock.includes('background: transparent') && ioBtnBlock.includes('box-shadow: none'), 'io button must match the dashed add-button format (no shadow)');
        // 自定义事件包行间隔与战斗/推理/恋爱一致（10px）
        const customRowsBlock = css.slice(css.indexOf('#st-direct-event-root #se-custom-rows {'), css.indexOf('}', css.indexOf('#st-direct-event-root #se-custom-rows {')));
        assert(customRowsBlock.includes('gap: 10px'), 'custom rows must share the 10px rhythm');
    });
    check('Sub-prompt saves skip unchanged defaults and heal baked overrides',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(src.includes('function getSubPromptFallback'), 'fallback resolver missing');
        assert(src.includes('return getSubPromptFallback(eventKey, genreOrFeatureKey, s);'), 'getSubPrompt must delegate to fallback');
        assert(src.split('=== String(getSubPromptFallback(evKey, subKey, s)).trim()').length - 1 === 2, 'both save paths must compare against fallback before writing');
        const hb = harness();
        const s = hb.api.getSettings();
        s.customTemplates = [{id:'ct_bfx', name:'行为测试', prefix:'e', turns:2, genres:[{id:'g1', label:'流派一', badge:'', desc:'', prompt:'条目原文'}], depths:[], extras:[]}];
        assert.equal(hb.api.getSubPromptFallback('ct_bfx','g1',s), '条目原文', 'fallback must resolve to template entry prompt');
        assert.equal(hb.api.getSubPrompt('ct_bfx','g1',s), '条目原文', 'no override must fall back to entry prompt');
        s.subPrompts = {'ct_bfx.g1':'用户覆盖'};
        assert.equal(hb.api.getSubPrompt('ct_bfx','g1',s), '用户覆盖', 'override must still win');
    });
    check('Deleting a custom template cleans its override keys but spares others',()=>{
        const hb2 = harness();
        const s2 = hb2.api.getSettings();
        s2.customTemplates = [{id:'ct_del1', name:'删除测试', prefix:'f', turns:2, genres:[{id:'g1', label:'流派', badge:'', desc:'', prompt:'p'}], depths:[], extras:[]}];
        s2.presets = {ct_del1:{systemPrompt:'主覆盖'}};
        s2.subPrompts = {'ct_del1.g1':'流派覆盖','ct_keep.g1':'其他模板覆盖'};
        hb2.api.persistSettings(s2);
        hb2.api.deleteCustomTemplate('ct_del1');
        const after = hb2.api.getSettings();
        assert(!after.presets || !after.presets.ct_del1, 'presets[templateId] must be cleaned');
        assert(!Object.keys(after.subPrompts||{}).some(k=>k.startsWith('ct_del1.')), 'subPrompts prefix keys must be cleaned');
        assert.equal(after.subPrompts['ct_keep.g1'], '其他模板覆盖', 'other template overrides must survive');
        assert(!after.customTemplates.some(t=>t.id==='ct_del1'), 'template must be removed');
    });
    check('Custom template events trigger by short id like fixed ones',()=>{
        const hb3 = harness();
        const st = hb3.api.getChatState();
        st.events.push({id:'校园异闻e0001', title:'校园异闻', type:'ct_bfx', content:'', maxTurns:2, stages:[{content:'x'}]});
        st.events.push({id:'校园异闻x20001', title:'校园异闻', type:'ct_bfx', content:'', maxTurns:2, stages:[{content:'x'}]});
        assert.equal(hb3.api.findTriggeredEvent('e0001') && hb3.api.findTriggeredEvent('e0001').id, '校园异闻e0001', 'e-prefix short id must trigger');
        assert.equal(hb3.api.findTriggeredEvent('x20001') && hb3.api.findTriggeredEvent('x20001').id, '校园异闻x20001', 'x2-prefix short id must trigger');
        assert.equal(hb3.api.findTriggeredEvent('我觉得刚才e0001这个事件不错'), null, 'incidental mentions must not trigger');
    });
    check('Prompt viewer mobile stacking fix and header close reach',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const openFn = src.slice(src.indexOf('async function openPromptViewerModal'), src.indexOf('function filterPromptViewerMessages'));
        assert(openFn.includes('if (isMobileView()) {') && openFn.includes("['se-settings', 'se-events', 'se-presets', 'se-api-log'].forEach"), 'viewer must hide source sub-panels on mobile before showing');
        assert(src.includes('class="se-pv-header-close" data-action="close-prompt-viewer"'), 'viewer header text close button missing');
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8').replace(/\r\n/g, '\n');
        const mq = css.slice(css.indexOf('@media (max-width: 768px)'), css.indexOf('/* 滚动条（主面板内容区 + 各二级弹窗内滚容器） */'));
        assert(css.includes('.se-pv-header-close {\n        display: none;\n    }'), 'pv header close must default to hidden on desktop');
        assert(mq.includes('.se-prompt-viewer-modal .se-modal-header .se-pv-row-icon-btn') && mq.includes('display: none !important'), 'viewer icon buttons must be hidden on mobile');
        assert(mq.includes('.se-prompt-viewer-modal .se-modal-header .se-pv-header-close') && mq.includes('display: inline-flex !important'), 'viewer text close must show on mobile');
        const closeBlock = css.slice(css.indexOf('.se-prompt-viewer-modal .se-modal-header .se-pv-header-close'), css.indexOf('}', css.indexOf('.se-prompt-viewer-modal .se-modal-header .se-pv-header-close')));
        assert(!closeBlock.includes('padding') && !closeBlock.includes('font-size') && !closeBlock.includes('font-weight') && !closeBlock.includes('min-height'), 'viewer close button must fall back to the shared .se-modal-header button sizing (no mobile-only enlargement)');
        assert(css.includes('.se-modal-header button {\n    padding: 4px 10px;\n    font-size: 12px;'), 'shared modal header button rule must remain the sizing source for all modal close buttons');
    });
    check('Overflow hardening: dvh fallbacks for desktop-mode shells and shrinkable header titles',()=>{
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8').replace(/\r\n/g, '\n');
        const viewer = css.slice(css.indexOf('\n    .se-prompt-viewer-modal {'), css.indexOf('}', css.indexOf('\n    .se-prompt-viewer-modal {')));
        assert(viewer.includes('max-height: 90vh;') && viewer.includes('max-height: calc(90dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));'), 'viewer shell must carry the dvh+safe-area fallback for >768 desktop-mode viewports');
        const wi = css.slice(css.indexOf('\n.se-world-info-modal {'), css.indexOf('}', css.indexOf('\n.se-world-info-modal {')));
        assert(wi.includes('max-height: calc(100vh - 60px);') && wi.includes('max-height: calc(100dvh - 60px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));'), 'world-info shell (one rule shared by five modals) must carry the dvh+safe-area fallback');
        assert(css.includes('.se-modal-header > span:first-child {\n    min-width: 0;\n    overflow-wrap: anywhere;\n}'), 'header title span must be shrinkable so pathological long tokens cannot push the close button out of the shell');
    });
    check('Mobile fix: viewer search row wraps and match-only checkbox takes its own line',()=>{
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8').replace(/\r\n/g, '\n');
        const mq = css.slice(css.indexOf('@media (max-width: 768px)'), css.indexOf('/* 滚动条（主面板内容区 + 各二级弹窗内滚容器） */'));
        assert(mq.includes('.se-pv-filter-row {\n        flex-wrap: wrap !important;'), 'pv filter row must wrap on mobile');
        assert(mq.includes('.se-pv-filter-row .se-pv-checkbox-label {\n        flex-basis: 100% !important;'), 'nowrap checkbox must take a full line instead of being clipped off-canvas');
    });
    check('Mobile fix: viewer search input shrink hardened and authored transparent style restored',()=>{
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8').replace(/\r\n/g, '\n');
        const mq = css.slice(css.indexOf('@media (max-width: 768px)'), css.indexOf('/* 滚动条（主面板内容区 + 各二级弹窗内滚容器） */'));
        assert(mq.includes('.se-pv-search-box {\n        min-width: 0 !important;') && mq.includes('.se-pv-search-input {\n        min-width: 0 !important;'), 'pv search shrink must be hardened against host cascade');
        assert(css.includes('#st-direct-event-root .se-pv-search-box .se-pv-search-input {\n        flex: 1;\n        min-width: 0;\n        padding: 0;\n        background: transparent !important;\n        border: none !important;'), 'pv search input must keep authored transparent borderless look ((1,2,0)+!important beats the (1,1,1) contrast lock, no box-in-box)');
    });
    check('Mobile fix: viewer message rows stack desc/snippet full-width and grow copy touch target',()=>{
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8').replace(/\r\n/g, '\n');
        assert(css.includes('.se-pv-role-desc {\n        font-size: 11px;\n        font-weight: 600;\n        color: var(--se-text-title);\n        white-space: nowrap;\n        overflow: hidden;\n        text-overflow: ellipsis;\n    }'), 'role desc must ellipsize in place instead of overflowing under copy/expand buttons');
        const mq = css.slice(css.indexOf('@media (max-width: 768px)'), css.indexOf('/* 滚动条（主面板内容区 + 各二级弹窗内滚容器） */'));
        assert(mq.includes('.se-pv-row-left {\n        flex-wrap: wrap !important;'), 'pv row left must wrap on mobile');
        assert(mq.includes('.se-pv-row-left .se-pv-role-desc,\n    #st-direct-event-root .se-pv-row-left .se-pv-snippet {\n        flex-basis: 100% !important;'), 'desc/snippet must take full lines on mobile');
        assert(mq.includes('.se-pv-row-icon-btn {\n        padding: 8px 10px !important;'), 'row copy button touch target must grow on mobile');
    });
    check('Mobile fix: viewer meta and stats rows wrap with breakable model names',()=>{
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8').replace(/\r\n/g, '\n');
        const mq = css.slice(css.indexOf('@media (max-width: 768px)'), css.indexOf('/* 滚动条（主面板内容区 + 各二级弹窗内滚容器） */'));
        assert(mq.includes('.se-pv-meta-row {\n        flex-wrap: wrap !important;') && mq.includes('.se-pv-meta-row strong {\n        overflow-wrap: anywhere;'), 'meta row must wrap and long model names must break');
        assert(mq.includes('.se-pv-stats-row {\n        flex-wrap: wrap !important;'), 'stats row must wrap on mobile');
    });
    check('Mobile fix: variable/world-info search counter takes its own line instead of clipping to first char',()=>{
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8').replace(/\r\n/g, '\n');
        const mq = css.slice(css.indexOf('@media (max-width: 768px)'), css.indexOf('/* 滚动条（主面板内容区 + 各二级弹窗内滚容器） */'));
        assert(mq.includes('.se-wi-search-row {\n        flex-wrap: wrap !important;'), 'wi search row must wrap on mobile');
        assert(mq.includes('.se-wi-search-row .se-wi-counter {\n        flex-basis: 100% !important;'), 'nowrap counter (已选 X 个顶层分支…) must take a full line');
        assert(mq.includes('.se-wi-search-input {\n        min-width: 0 !important;'), 'wi search input shrink must be hardened');
        assert(css.includes('#st-direct-event-root .se-wi-search-input {\n    flex: 1;\n    min-width: 0;\n    padding: 6px 12px;\n    font-size: 12px;'), 'wi search input must win specificity over the global input rule');
    });
    check('Mobile fix: stage outline status bar, turns ctrls and view tabs wrap on narrow screens',()=>{
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8').replace(/\r\n/g, '\n');
        assert(css.includes('#st-direct-event-root .se-stage-turns-ctrls { flex-wrap: wrap; row-gap: 4px; }'), 'stage turns ctrls must wrap (the missing sibling of the 540px event-list fix)');
        assert(css.includes('#st-direct-event-root .se-stage-status-bar { flex-wrap: wrap; row-gap: 6px; }'), 'stage status bar must wrap on mobile');
        assert(css.includes('#st-direct-event-root .se-stage-view-tabs { flex-wrap: wrap; row-gap: 6px; }'), 'stage view tabs must wrap instead of squeezing into vertical text');
    });
    check('Mobile fix: event actions and import/export rows wrap; API log urls break',()=>{
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8').replace(/\r\n/g, '\n');
        assert(css.includes('#st-direct-event-root .se-event-actions { flex-wrap: wrap; }'), 'event card actions must wrap on narrow screens');
        const tioBase = css.indexOf('#st-direct-event-root .se-tio-row .se-btn-action {\n    flex: 1 1 0;');
        const tioMq = css.indexOf('@media (max-width: 540px) {\n    #st-direct-event-root .se-tio-row {');
        assert(tioBase > -1 && tioMq > tioBase, 'tio-row MQ block must sit after its base rules to win the cascade');
        assert(css.slice(tioMq).includes('min-width: max-content;'), 'nowrap export buttons must refuse text truncation and wrap whole');
        assert(css.includes('.se-api-log-url,\n.se-api-log-type {\n    word-break: break-all;\n    overflow-wrap: anywhere;'), 'api log url/type lines must break long urls');
    });
    check('Mobile fix: inline 2-col grids collapse via se-grid-2col and heroine row wraps',()=>{
        const css = fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8').replace(/\r\n/g, '\n');
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(src.split('class="se-grid-2col"').length - 1 === 2, 'both inline 1fr 1fr grids must carry the se-grid-2col class');
        assert(css.includes('#st-direct-event-root .se-grid-2col { grid-template-columns: 1fr !important; }'), '2-col grids must collapse to one column on narrow screens');
        assert(src.includes('display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:8px;'), 'heroine lock row must wrap so the clear button stays reachable');
        assert(css.includes('#st-direct-event-root #se-sub-target-heroine {\n        min-width: 150px;'), 'heroine input must keep a usable min width instead of being squeezed to ~73px');
    });
    check('PLUGIN_VERSION matches manifest and stale version strings are gone',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        const mf = JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.json'),'utf8'));
        const m = src.match(/const PLUGIN_VERSION = '([^']+)'/);
        assert(m, 'PLUGIN_VERSION constant missing');
        assert.equal(m[1], mf.version, 'PLUGIN_VERSION must match manifest version');
        assert(!src.includes('v0.6.0'), 'stale v0.6.0 strings must be removed');
    });
    check('Bugfix wiring across generation/ui/data layers',()=>{
        const src = fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
        assert(src.includes('longPressFired = true') && src.includes('if (!longPressFired) return;'), 'long-press synthetic click swallow missing');
        assert(src.includes('id.match(/[a-z]') && !src.includes('[abcd]'), 'short-id whitelist not widened');
        assert(src.includes('sendNotice + escapeHtml(event.id)') && src.includes('已删除事件 ${escapeHtml(eventId)}'), 'event.id must be escaped in toasts');
        assert(src.includes("已删除自定义事件包「' + escapeHtml(name) + '」"), 'template name must be escaped in delete toast');
        assert(src.split('data-id="${CSS.escape(id)}"').length - 1 === 2, 'turn inputs must CSS.escape event id');
        assert(src.includes('entry.seq = ++apiLogSeq') && src.includes('expandedApiLogs.has(log.seq)') && !src.includes('expandedApiLogs.has(index)'), 'api log expand state must key by seq');
        assert(src.includes('attemptTimedOut') && src.includes('&& attemptTimedOut)'), 'timeout classification missing');
        assert(src.includes('hasContentOverride') && src.includes('hasTitleOverride'), 'world-info empty override handling missing');
        assert(src.includes('回合上限已达 30 回合'), 'cap-reached toast missing');
        assert(src.includes('modelListLoading') && src.includes('connectionTestLoading'), 'request locks missing');
        assert(src.includes('wandKeepAliveTimer') && src.includes('drawerWaitTimer'), 'init retry guards missing');
        const bindHead = src.slice(src.indexOf('function bindSTEvents'), src.indexOf('MESSAGE_SENT'));
        assert(bindHead.includes('stEventsBound = true'), 'stEventsBound must be set before first registration');
        assert(src.includes('setGeneratingUI(currentGeneratingTypeKey, true)'), 'generating visual restore missing');
    });
    check('Production source contains no pictographs',()=>{for(const file of ['index.js','style.css']) assert(!/\p{Extended_Pictographic}/u.test(fs.readFileSync(path.join(__dirname,'..',file),'utf8')));});
    const report={checks,passed:true,date:new Date().toISOString()};fs.writeFileSync(path.join(__dirname,'regression-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(err=>{console.error(err.stack);process.exitCode=1;});
