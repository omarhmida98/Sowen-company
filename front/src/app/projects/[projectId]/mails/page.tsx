'use client';
import {useParams} from 'next/navigation';
import {Shell} from '@/components/Shell';
import {EmailManager} from '@/components/EmailManager';
export default function Page(){const {projectId}=useParams<{projectId:string}>();return <Shell><EmailManager projectId={projectId}/></Shell>}
