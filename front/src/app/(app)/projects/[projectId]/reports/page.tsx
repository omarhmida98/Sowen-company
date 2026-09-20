'use client';
import {useParams} from 'next/navigation';

import {ReportsManager} from '@/components/ReportsManager';
export default function Page(){const {projectId}=useParams<{projectId:string}>();return <><ReportsManager projectId={projectId}/></>}
