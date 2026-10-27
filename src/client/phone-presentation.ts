// Presentation only: never rewrite the raw phone value held by the editor.
export function phonePresentation(raw:string):string{
 const match=/^([+\d\s().-]+?)(\s*(?:ext\.?|x|#)\s*\d+)?$/i.exec(raw.trim());
 if(!match)return raw;
 const digits=match[1]!.replace(/\D/g,''),extension=match[2]??'';
 if(digits.length===10&&!match[1]!.trim().startsWith('+'))return '('+digits.slice(0,3)+') '+digits.slice(3,6)+'-'+digits.slice(6)+extension;
 if(digits.length===11&&digits.startsWith('1'))return '+1 ('+digits.slice(1,4)+') '+digits.slice(4,7)+'-'+digits.slice(7)+extension;
 return raw;
}
