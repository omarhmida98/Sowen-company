'use client';
import {useParams} from 'next/navigation';

import {ObservationManager} from '@/components/ObservationManager';
export default function Page(){const {projectId}=useParams<{projectId:string}>();return <><ObservationManager projectId={projectId}/></>}
