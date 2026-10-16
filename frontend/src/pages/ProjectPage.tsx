/**
 * Route component for the project domain.
 */

import { useTranslation } from 'react-i18next'
import ProjectList from '@/sections/project/ProjectList'
import PageHeader from '@/components/page-header/PageHeader'

export default function ProjectPage() {
  const { t } = useTranslation('project')

  return (
    <>
      <PageHeader heading={t('title')} description={t('description')} links={[{ label: t('title') }]} />
      <ProjectList />
    </>
  )
}
