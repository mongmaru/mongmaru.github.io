// Display preferences stay on this device, outside planner history and Drive.
const KEY='hplan-view-layout-v1';
export class ViewLayout {
 constructor(storage){
  this.storage=storage;this.value={navigationCollapsed:false,personal:true,question:true};
  try{const saved=JSON.parse(storage.getItem(KEY));for(const key of Object.keys(this.value))if(typeof saved?.[key]==='boolean')this.value[key]=saved[key];}catch{}
 }
 shows(kind){return kind==='personal'||kind==='question'?this.value[kind]:true;}
 toggle(key){
  if(!Object.hasOwn(this.value,key))return;
  this.value[key]=!this.value[key];
  try{this.storage.setItem(KEY,JSON.stringify(this.value));}catch{}
 }
}
