import { captureHoldFullRs } from "@alt1/base";
import { readStackNumber, readMoneyGain } from "./ocr";
import { aHash64 } from "./phash";
import { AppState, LootEntry, Rect, Session } from "./storage";
import { getRegionFromAlt1 } from "./alt1region";

type RunState = "idle" | "running" | "paused";

type SlotSnap = {
  sig: string | null;
  qty: number | null;
};

export class LootTracker {
  private state: AppState;
  private runState: RunState = "idle";
  private invRegion: Rect | null;
  private moneyRegion: Rect | null;

  private slots: SlotSnap[] = Array.from({ length: 28 }, () => ({
    sig: null,
    qty: null
  }));

  private loot: Record<string, LootEntry> = {};
  private iconCache: Record<string,string> = {};
  private timer: number | null = null;
  private updateCb: (() => void) | null = null;

  constructor(state: AppState) {
    this.state = state;
    this.invRegion = state.settings.invRegion ?? null;
    this.moneyRegion = state.settings.moneyRegion ?? null;
  }

  onUpdate(cb: () => void){ this.updateCb = cb; }

  hasInventoryRegion(){ return !!this.invRegion; }
  hasMoneyRegion(){ return !!this.moneyRegion; }
  getRunState(){ return this.runState; }

  getCurrentLoot(): LootEntry[] {
    return Object.values(this.loot).sort((a,b)=>b.qty-a.qty);
  }

  getIconPngDataUrl(sig:string){
    return this.iconCache[sig] ?? null;
  }

  reset(){
    this.loot = {};
    this.slots = this.slots.map(()=>({sig:null,qty:null}));
  }

  async calibrateInventoryRegion(){
    const r = await getRegionFromAlt1();
    if(!r) return false;
    this.invRegion = r;
    this.state.settings.invRegion = r;
    return true;
  }

  async calibrateMoneyRegion(){
    const r = await getRegionFromAlt1();
    if(!r) return false;
    this.moneyRegion = r;
    this.state.settings.moneyRegion = r;
    return true;
  }

  start(label:string){
    if(!this.invRegion) return;

    this.runState="running";
    this.captureAndUpdate(true);

    this.timer = window.setInterval(()=>{
      if(this.runState!=="running") return;
      this.captureAndUpdate(false);
    },600);

    this.state.activeSession={
      id:crypto.randomUUID(),
      label,
      startedAt:Date.now(),
      endedAt:null,
      loot:[]
    };

    this.updateCb?.();
  }

  togglePause(){
    if(this.runState==="idle") return;
    this.runState=this.runState==="paused"?"running":"paused";
    this.updateCb?.();
  }

  stop(){
    this.runState="idle";
    if(this.timer) clearInterval(this.timer);

    const s=this.state.activeSession;
    if(s){
      s.endedAt=Date.now();
      s.loot=this.getCurrentLoot();
      this.state.sessions.unshift(s as Session);
      this.state.activeSession=null;
    }

    this.updateCb?.();
  }

  private captureAndUpdate(isBaseline:boolean){
    if(!this.invRegion) return;

    const img:any = captureHoldFullRs();
    if(!img) return;

    const cols=4, rows=7;
    const slotW=Math.floor(this.invRegion.w/cols);
    const slotH=Math.floor(this.invRegion.h/rows);

    for(let i=0;i<28;i++){
      const col=i%cols;
      const row=Math.floor(i/cols);

      const sx=this.invRegion.x+col*slotW;
      const sy=this.invRegion.y+row*slotH;

      const icon:any = img.crop(sx+2,sy+Math.floor(slotH*0.22),slotW-4,slotH-4);
      const num:any = img.crop(sx+1,sy+1,Math.floor(slotW*0.7),Math.floor(slotH*0.4));

      const sig=aHash64(icon);
      const qty=readStackNumber(num);

      this.applySlotUpdate(i,sig,qty,isBaseline);
    }

    if(!isBaseline && this.moneyRegion){
      const money:any=img.crop(this.moneyRegion.x,this.moneyRegion.y,this.moneyRegion.w,this.moneyRegion.h);
      const gain=readMoneyGain(money);
      if(gain) this.addLoot("coins:pouch","Coins (Money Pouch)",gain);
    }

    this.updateCb?.();
  }

  private applySlotUpdate(i:number,sig:string|null,qty:number|null,isBaseline:boolean){
    const slot=this.slots[i];

    if(!sig||qty===null) return;

    const prevSig=slot.sig;
    const prevQty=slot.qty;

    slot.sig=sig;
    slot.qty=qty;

    if(isBaseline) return;

    if(prevSig!==sig||prevQty===null){
      this.addLoot(sig,this.displayName(sig),qty);
      return;
    }

    if(qty>prevQty){
      this.addLoot(sig,this.displayName(sig),qty-prevQty);
    }
  }

  private addLoot(key:string,name:string,qty:number){
    if(!this.loot[key]){
      this.loot[key]={key,name,qty:0,iconSig:key};
    }
    this.loot[key].qty+=qty;

    if(this.state.activeSession){
      this.state.activeSession.loot=this.getCurrentLoot();
    }
  }

  private displayName(sig:string){
    return this.state.iconNames[sig] ?? `Unidentified (${sig.slice(0,6)})`;
  }
}