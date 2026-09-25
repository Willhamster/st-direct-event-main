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
        assert(src.includes("document.removeEventListener('click', onDocumentClickUI)"));
        assert(src.includes("document.addEventListener('click', onDocumentClickUI)"));
    });

    check('Production source contains no pictographs',()=>{for(const file of ['index.js','style.css']) assert(!/\p{Extended_Pictographic}/u.test(fs.readFileSync(path.join(__dirname,'..',file),'utf8')));});
    const report={checks,passed:true,date:new Date().toISOString()};fs.writeFileSync(path.join(__dirname,'regression-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(err=>{console.error(err.stack);process.exitCode=1;});
