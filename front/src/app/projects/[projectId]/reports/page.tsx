'use client';
import {useParams} from 'next/navigation';
import {Shell} from '@/components/Shell';
import {ReportsManager} from '@/components/ReportsManager';
export default function Page(){const {projectId}=useParams<{projectId:string}>();return <Shell><ReportsManager projectId={projectId}/></Shell>}
