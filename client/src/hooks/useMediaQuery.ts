import {useSyncExternalStore} from "react";
export function useMediaQuery(query:string){return useSyncExternalStore(listener=>{const media=window.matchMedia(query);media.addEventListener("change",listener);return()=>media.removeEventListener("change",listener);},()=>window.matchMedia(query).matches,()=>false);}
