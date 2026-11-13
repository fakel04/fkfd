import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMcpRequest} from '../app/mcp-protocol.ts';
import {readBoardTool} from '../app/mcp-tools.ts';
import {AccessError} from '../app/access-store.ts';
import {moveToFocus} from '../app/board-model.ts';

const note=(id,extra={})=>({id,title:id,text:'Текст заметки',tasks:[],color:'white',category:'Работа',pinned:false,archived:false,deleted:false,created:'2026-11-12',...extra});
const task=(id,extra={})=>({id,text:id,done:false,...extra});
const board={notes:[note('Картон',{tasks:[task('Заказать упаковку',{todoist:{id:'td1',projectId:'p1',description:'Проверить чертежи',labels:['Регина'],priority:'2',recurring:false,dueDate:'2026-11-30'}}),task('Готово',{done:true}),task('Созвон')]}),note('Архив',{archived:true,tasks:[task('Заказать упаковку в архиве')]}),note('Корзина',{deleted:true,tasks:[task('Заказать упаковку в корзине')]})],categories:['Работа']};
const session={userId:'invited-viewer',email:'relay@example.com',name:'Reader',role:'viewer',boardId:'owner-board'};
const request=(method,params,id=1)=>new Request('https://test.example/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
const decode=async response=>JSON.parse((await response.json()).result.content[0].text);

test('MCP discovery has only read tools and never reads records',async()=>{
 const deps={authorize:async()=>{throw new Error('no auth expected')},read:async()=>{throw new Error('no reads expected')}};
 const discovery=await (await handleMcpRequest(request('server/discover'),deps)).json();assert.deepEqual(discovery.result.supportedVersions,['2026-07-28']);
 const list=await (await handleMcpRequest(request('tools/list'),deps)).json();assert.equal(list.result.tools.length,3);assert.ok(list.result.tools.every(t=>t.annotations.readOnlyHint&&!t.annotations.destructiveHint));
});
test('anonymous, revoked and unknown users cannot read data through MCP',async()=>{
 for(const status of [401,403]){
  let reads=0;const response=await handleMcpRequest(request('tools/call',{name:'list_clouds'}),{authorize:async()=>{throw new AccessError('Нет доступа',status)},read:async()=>{reads++;return{data:board,revision:1}}});
  assert.equal(response.status,status);assert.equal(reads,0);assert.equal((await response.json()).error.code,-32001);
 }
});
test('verified viewer reads the authorized shared board with no client-selected identity',async()=>{
 let reads=0;const deps={authorize:async()=>session,read:async actual=>{reads++;assert.deepEqual(actual,session);return{data:board,revision:26}}};
 const output=await decode(await handleMcpRequest(request('tools/call',{name:'get_cloud',arguments:{cloud_id:'Картон'}}),deps));
 assert.equal(output.revision,26);assert.equal(output.tasks.total,3);assert.equal(output.tasks.items[0].todoist.dueDate,'2026-11-30');assert.equal(reads,1);
 const invalid=await (await handleMcpRequest(request('tools/call',{name:'list_clouds',arguments:{board_id:'other-private-board'}}),deps)).json();assert.equal(invalid.result.isError,true);
});
test('pagination covers all tasks in manual order and completed filter preserves positions',()=>{
 const first=readBoardTool('get_cloud',{cloud_id:'Картон',limit:2},board,26);const second=readBoardTool('get_cloud',{cloud_id:'Картон',offset:first.tasks.next_offset,limit:2},board,26);
 assert.deepEqual([...first.tasks.items,...second.tasks.items].map(t=>t.id),['Заказать упаковку','Готово','Созвон']);assert.equal(second.tasks.next_offset,null);
 assert.deepEqual(readBoardTool('get_cloud',{cloud_id:'Картон',include_completed:false},board,26).tasks.items.map(t=>t.position),[0,2]);
 assert.equal(readBoardTool('list_clouds',{},board,26).total,1);assert.equal(readBoardTool('list_clouds',{scope:'all'},board,26).total,3);
});
test('search includes descriptions, tags, Russian text and moved task source without duplicate tasks',()=>{
 const moved=moveToFocus(board,'Картон','Заказать упаковку');
 const result=readBoardTool('search_tasks',{query:'регина чертежи картон'},moved,27);assert.equal(result.total,1);assert.equal(result.items[0].cloud_id,'__focus_tasks__');assert.equal(result.items[0].source_cloud.title,'Картон');
 assert.equal(readBoardTool('search_tasks',{query:'упаковку'},board,26).total,1);
 assert.equal(readBoardTool('search_tasks',{query:'упаковку',scope:'all'},board,26).total,3);
 assert.equal(readBoardTool('search_tasks',{query:'готово'},board,26).total,0);
 assert.equal(readBoardTool('search_tasks',{query:'готово',include_completed:true},board,26).total,1);
});
test('invalid protocol, unknown tools, unsupported methods and missing clouds fail explicitly',async()=>{
 const deps={authorize:async()=>session,read:async()=>({data:board,revision:1})};
 const malformed=await handleMcpRequest(new Request('https://test.example/mcp',{method:'POST',body:'{'}),deps);assert.equal(malformed.status,400);
 const unknown=await (await handleMcpRequest(request('tools/call',{name:'delete_board'}),deps)).json();assert.equal(unknown.error.code,-32602);
 const missing=await (await handleMcpRequest(request('tools/call',{name:'get_cloud',arguments:{cloud_id:'missing'}}),deps)).json();assert.equal(missing.result.isError,true);
 assert.equal((await handleMcpRequest(new Request('https://test.example/mcp'),deps)).status,405);
 const badLimit=await (await handleMcpRequest(request('tools/call',{name:'list_clouds',arguments:{limit:10000}}),deps)).json();assert.equal(badLimit.result.isError,true);
});
