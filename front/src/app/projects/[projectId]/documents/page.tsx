'use client';
import {useParams} from 'next/navigation';
import {Shell} from '@/components/Shell';
import {DocumentManager} from '@/components/DocumentManager';
export default function Page(){const {projectId}=useParams<{projectId:string}>();return <Shell><DocumentManager projectId={projectId}/></Shell>}
