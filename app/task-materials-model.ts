import {z} from 'zod';

export const MAX_FILE_BYTES=10*1024*1024;
export const MAX_TASK_MATERIALS=200;
export const sourceNames={other:'Без источника',gpt:'GPT',claude:'Claude'} as const;
export function materialUrl(value:string):string{
 const text=value.trim();if(!text)return '';
 let url:URL;try{url=new URL(text)}catch{throw new Error('Вставьте полную ссылку с https://.')}
 if(url.protocol!=='https:'||url.username||url.password)throw new Error('Нужна ссылка с https:// без логина и пароля.');
 if(text.length>2048||url.href.length>2048)throw new Error('Ссылка слишком длинная.');
 return url.href;
}
const urlSchema=z.string().max(2048).transform((value,ctx)=>{try{return materialUrl(value)}catch(error){ctx.addIssue({code:z.ZodIssueCode.custom,message:(error as Error).message});return z.NEVER}});
export const materialInput=z.object({
 kind:z.enum(['summary','link']),text:z.string().trim().max(20000).default(''),title:z.string().trim().max(300).default(''),
 source:z.enum(['gpt','claude','other']).default('other'),sourceUrl:urlSchema.default(''),url:urlSchema.default(''),
}).superRefine((value,ctx)=>{
 if(value.kind==='summary'&&!value.text)ctx.addIssue({code:z.ZodIssueCode.custom,path:['text'],message:'Введите комментарий или саммари.'});
 if(value.kind==='link'&&!value.url)ctx.addIssue({code:z.ZodIssueCode.custom,path:['url'],message:'Добавьте ссылку на материал.'});
});
export type MaterialInput=z.infer<typeof materialInput>;
export const fileMaterialInput=z.object({text:z.string().trim().max(20000).default(''),title:z.string().trim().max(300).default(''),source:z.enum(['gpt','claude','other']).default('other'),sourceUrl:urlSchema.default('')});
export type FileMaterialInput=z.infer<typeof fileMaterialInput>;
export type TaskMaterial={id:string;kind:'summary'|'link'|'file';text:string;title:string;source:'gpt'|'claude'|'other';sourceUrl:string;url:string;fileName:string|null;fileSize:number|null;authorName:string;createdAt:string;updatedAt:string;revision:number};
export function attachmentName(value:string){return value.replace(/[\x00-\x1f\x7f/\\]/g,'_').trim().slice(0,240)||'Вложение'}
export const materialBase=(taskId:string)=>'/api/tasks/'+encodeURIComponent(taskId)+'/materials';
