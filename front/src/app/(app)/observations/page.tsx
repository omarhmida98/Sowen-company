import {ObservationManager} from '@/components/ObservationManager';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const sp=await searchParams;return <><ObservationManager status={typeof sp.status==='string'?sp.status:undefined} filter={typeof sp.filter==='string'?sp.filter:undefined}/></>}
