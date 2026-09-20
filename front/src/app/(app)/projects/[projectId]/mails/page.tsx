'use client';
import {useParams} from 'next/navigation';

import {EmailManager} from '@/components/EmailManager';
export default function Page(){const {projectId}=useParams<{projectId:string}>();return <><EmailManager projectId={projectId}/></>}
