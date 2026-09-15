'use client';
import {useParams} from 'next/navigation';
import {Shell} from '@/components/Shell';
import {ObservationManager} from '@/components/ObservationManager';
export default function Page(){const {projectId}=useParams<{projectId:string}>();return <Shell><ObservationManager projectId={projectId}/></Shell>}
