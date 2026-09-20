'use client';
import {useParams} from 'next/navigation';

import {DocumentManager} from '@/components/DocumentManager';
export default function Page(){const {projectId}=useParams<{projectId:string}>();return <><DocumentManager projectId={projectId}/></>}
