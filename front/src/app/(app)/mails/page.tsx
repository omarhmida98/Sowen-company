import {EmailManager} from '@/components/EmailManager';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const sp=await searchParams;return <><EmailManager filter={typeof sp.filter==='string'?sp.filter:undefined}/></>}
