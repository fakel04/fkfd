export type AiProvider = 'gpt'|'claude';
export const aiProviders = {
 gpt:{name:'GPT',field:'gptUrl',placeholder:'https://chatgpt.com/c/…'},
 claude:{name:'Claude',field:'claudeUrl',placeholder:'https://claude.ai/chat/…'},
} as const;

/** Only HTTPS links to the selected service can become clickable task links. */
export function normalizeAiLink(provider:AiProvider,value:string):string|null {
 const text=value.trim();
 if(!text)return null;
 if(text.length>2048)throw new Error('Ссылка слишком длинная (максимум 2048 символов).');
 const hosts=provider==='gpt'?['chatgpt.com','www.chatgpt.com','chat.openai.com']:['claude.ai','www.claude.ai'];
 let url:URL;
 try{url=new URL(text)}catch{throw new Error('Вставьте полную ссылку, начинающуюся с https://.')}
 if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.includes(url.hostname))
  throw new Error(provider==='gpt'?'Нужна ссылка на chatgpt.com или chat.openai.com.':'Нужна ссылка на claude.ai.');
 return url.href;
}

export function safeAiLink(provider:AiProvider,value?:string|null):string|null {
 try{return normalizeAiLink(provider,value??'')}catch{return null}
}
