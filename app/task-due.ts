const pad=(value:number)=>String(value).padStart(2,'0');
export const localDate=(date:Date)=>`${String(date.getFullYear()).padStart(4,'0')}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
export function validDate(value:string):boolean{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T12:00:00Z');
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function dueParts(value:string|null):{date:string;time:string}{
 if(!value)return{date:'',time:''};
 if(validDate(value))return{date:value,time:''};
 const date=new Date(value);
 return Number.isNaN(date.getTime())?{date:'',time:''}:{date:localDate(date),time:`${pad(date.getHours())}:${pad(date.getMinutes())}`};
}
export function makeDueDate(date:string,time:string):string|null{
 if(!validDate(date))return null;
 if(!time)return date;
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return null;
 return new Date(`${date}T${time}:00`).toISOString();
}
export function shortDueDate(value:string):string{
 const {date}=dueParts(value);
 return date?`${date.slice(8,10)}.${date.slice(5,7)}`:'';
}
