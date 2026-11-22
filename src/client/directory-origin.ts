export type DirectoryOrigin=Readonly<{element:HTMLElement;scrollY:number;width:number;height:number;containers:readonly Readonly<{element:HTMLElement;top:number}>[]}>;

export function captureDirectoryOrigin(element:HTMLElement):DirectoryOrigin{
 const containers:{element:HTMLElement;top:number}[]=[];
 for(let parent=element.parentElement;parent;parent=parent.parentElement){
  if(parent!==document.scrollingElement&&/^(auto|scroll|overlay)$/.test(window.getComputedStyle(parent).overflowY)&&parent.scrollHeight>parent.clientHeight)containers.push(Object.freeze({element:parent,top:parent.scrollTop}));
 }
 return Object.freeze({element,scrollY:Math.max(0,window.scrollY),width:window.innerWidth,height:window.innerHeight,containers:Object.freeze(containers)});
}

export function restoreDirectoryOrigin(origin:DirectoryOrigin|null,fallback:HTMLElement|null){
 const target=origin?.element.isConnected?origin.element:fallback;
 if(!target?.isConnected)return;
 const sameGeometry=origin?.element===target&&origin.width===window.innerWidth&&origin.height===window.innerHeight;
 target.focus({preventScroll:sameGeometry});
 if(!sameGeometry)return;
 for(const container of [...origin.containers].reverse())if(container.element.isConnected)container.element.scrollTop=container.top;
 window.scrollTo({top:origin.scrollY,behavior:'instant'});
 const box=target.getBoundingClientRect(),clearance=parseFloat(window.getComputedStyle(document.documentElement).scrollPaddingBlockEnd)||0;
 if(Math.round(box.top)<0||Math.round(box.bottom)>Math.round(window.innerHeight-clearance))target.scrollIntoView({block:'center',behavior:'instant'});
}
