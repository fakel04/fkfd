export class SyncError extends Error {
 status:number;
 constructor(message:string,status:number){super(message);this.status=status}
}
export class ConnectionError extends Error {
 kind:'offline'|'network'|'timeout';
 constructor(kind:ConnectionError['kind'],message:string){super(message);this.kind=kind}
}
