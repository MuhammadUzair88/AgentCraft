import React from 'react';
import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

export default function Home() {
  return (
    <div>
   <h2>Hello World</h2>
   <UserButton/>
    </div>
  )
}