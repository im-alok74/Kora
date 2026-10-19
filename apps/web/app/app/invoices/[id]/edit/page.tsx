import DocumentEditor from '../../../../../components/DocumentEditor';

export default async function EditDraft({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentEditor draftId={id} />;
}
